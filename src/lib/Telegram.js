'use strict';

// Opt into the new file-handling behavior for node-telegram-bot-api.
// This makes content-type default to 'application/octet-stream' instead of
// auto-detecting, which is the intended future behavior of the library.
// We also pass explicit fileOptions (filename + contentType) on every send.
// See: https://github.com/yagop/node-telegram-bot-api/blob/master/doc/usage.md#sending-files
process.env.NTBA_FIX_350 = '1';
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;
const crypto = require('crypto');
const cron = require('node-cron');
const debug = require('debug')('Telegram');

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TELEGRAM_BACKUP_ENABLED,
  TELEGRAM_BACKUP_SCHEDULE,
  TELEGRAM_BACKUP_FILENAME,
  WG_PATH,
} = require('../config');

const BACKUP_FILE_PATH = `${WG_PATH}wg0.json`;
const HASH_FILE_PATH = `${WG_PATH}.telegram_backup_hash`;

module.exports = class Telegram {
  constructor() {
    this.bot = null;
    this.chatId = null;
    this.enabled = false;
    this.schedule = TELEGRAM_BACKUP_SCHEDULE;
    this.cronTask = null;
    this.lastMessageTime = 0;
    this.nextScheduledBackup = null;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      debug('Telegram backup is not configured (missing bot token or chat ID)');
      return;
    }

    if (TELEGRAM_BACKUP_ENABLED !== 'true') {
      debug('Telegram backup is disabled');
      return;
    }

    const tokenRegex = /^[0-9]{8,10}:[A-Za-z0-9_-]{35}$/;
    if (!tokenRegex.test(TELEGRAM_BOT_TOKEN)) {
      debug('Invalid Telegram bot token format');
      return;
    }

    const chatIdRegex = /^-?[0-9]+$/;
    if (!chatIdRegex.test(TELEGRAM_CHAT_ID)) {
      debug('Invalid Telegram chat ID format');
      return;
    }

    try {
      this.bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
      this.chatId = TELEGRAM_CHAT_ID;
      this.enabled = true;
      debug('Telegram backup service initialized');
      debug(`Chat ID: ${this.chatId}`);
      debug(`Schedule: ${this.schedule}`);
      this.initializeScheduledBackups();
    } catch (error) {
      debug('Failed to initialize Telegram bot:', error.message);
      this.enabled = false;
    }
  }

  initializeScheduledBackups() {
    if (!this.enabled) return;
    try {
      if (!cron.validate(this.schedule)) {
        debug(`Invalid cron expression: ${this.schedule}`);
        return;
      }
      this.cronTask = cron.schedule(this.schedule, async () => {
        debug('Running scheduled backup...');
        try {
          await this.sendBackupFile(false);
        } catch (error) {
          debug('Scheduled backup failed:', error.message);
        }
      });
      debug('Scheduled backups initialized successfully');
      this.calculateNextScheduledBackup();
    } catch (error) {
      debug('Failed to initialize scheduled backups:', error.message);
    }
  }

  calculateNextScheduledBackup() {
    if (!this.cronTask) return;
    try {
      const now = Date.now();
      if (this.schedule === '0 0 * * *') {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        this.nextScheduledBackup = tomorrow.getTime();
      } else if (this.schedule.startsWith('0 */')) {
        const hours = parseInt(this.schedule.split('*/')[1].split(' ')[0]);
        this.nextScheduledBackup = now + (hours * 60 * 60 * 1000);
      } else {
        this.nextScheduledBackup = now + (60 * 60 * 1000);
      }
    } catch (error) {
      debug('Failed to calculate next scheduled backup:', error.message);
    }
  }

  async calculateFileHash(filePath) {
    const fileBuffer = await fs.readFile(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  }

  async hasBackupChanged() {
    try {
      const currentHash = await this.calculateFileHash(BACKUP_FILE_PATH);
      try {
        const lastHash = await fs.readFile(HASH_FILE_PATH, 'utf8');
        return currentHash !== lastHash.trim();
      } catch (error) {
        return true;
      }
    } catch (error) {
      debug('Failed to check if backup changed:', error.message);
      return true;
    }
  }

  async saveBackupHash() {
    try {
      const currentHash = await this.calculateFileHash(BACKUP_FILE_PATH);
      await fs.writeFile(HASH_FILE_PATH, currentHash, 'utf8');
    } catch (error) {
      debug('Failed to save backup hash:', error.message);
    }
  }

  async enforceRateLimit() {
    const now = Date.now();
    const timeSinceLastMessage = now - this.lastMessageTime;
    if (timeSinceLastMessage < 1000) {
      const waitTime = 1000 - timeSinceLastMessage;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    this.lastMessageTime = Date.now();
  }

  async testConnection() {
    if (!this.enabled) {
      return { success: false, message: 'Telegram is not configured or enabled' };
    }
    try {
      await this.enforceRateLimit();
      const botInfo = await this.bot.getMe();
      const chat = await this.bot.getChat(this.chatId);
      return {
        success: true,
        message: 'Connection successful',
        botUsername: botInfo.username,
        chatTitle: chat.title || chat.first_name || 'Private Chat',
      };
    } catch (error) {
      debug('Connection test failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async sendBackupFile(forceUpload = false) {
    if (!this.enabled) {
      return { success: false, message: 'Telegram backup is not enabled' };
    }
    try {
      try {
        await fs.access(BACKUP_FILE_PATH);
      } catch (error) {
        return { success: false, message: 'Backup file does not exist' };
      }

      if (!forceUpload) {
        const hasChanged = await this.hasBackupChanged();
        if (!hasChanged) {
          return { success: true, skipped: true, message: 'Backup file has not changed' };
        }
      }

      await this.enforceRateLimit();

      const fileContent = await fs.readFile(BACKUP_FILE_PATH);
      const caption = `WireGuard Backup - ${new Date().toISOString()}`;
      await this.bot.sendDocument(this.chatId, fileContent, { caption }, {
        filename: TELEGRAM_BACKUP_FILENAME,
        contentType: 'application/json',
      });

      await this.saveBackupHash();
      debug('Backup file sent successfully');
      this.calculateNextScheduledBackup();

      return { success: true, message: 'Backup sent successfully', timestamp: Date.now() };
    } catch (error) {
      debug('Failed to send backup file:', error.message);
      return { success: false, message: error.message };
    }
  }

  async getStatus() {
    return {
      configured: this.enabled,
      enabled: this.enabled,
      schedule: this.schedule,
      nextScheduledBackup: this.nextScheduledBackup,
      lastBackup: await this.getLastBackupTime(),
    };
  }

  async getLastBackupTime() {
    try {
      const stats = await fs.stat(HASH_FILE_PATH);
      return stats.mtimeMs;
    } catch (error) {
      return null;
    }
  }

  shutdown() {
    if (this.cronTask) {
      this.cronTask.stop();
      debug('Cron task stopped');
    }
  }
};


/* eslint-disable no-console */
/* eslint-disable no-alert */
/* eslint-disable no-undef */
/* eslint-disable no-new */

'use strict';

function bytes(bytes, decimals, kib, maxunit) {
  kib = kib || false;
  if (bytes === 0) return '0 B';
  if (Number.isNaN(parseFloat(bytes)) && !Number.isFinite(bytes)) return 'NaN';
  const k = kib ? 1024 : 1000;
  const dm = decimals != null && !Number.isNaN(decimals) && decimals >= 0 ? decimals : 2;
  const sizes = kib
    ? ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB', 'BiB']
    : ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB', 'BB'];
  let i = Math.floor(Math.log(bytes) / Math.log(k));
  if (maxunit !== undefined) {
    const index = sizes.indexOf(maxunit);
    if (index !== -1) i = index;
  }
  // eslint-disable-next-line no-restricted-properties
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

const i18n = new VueI18n({
  locale: localStorage.getItem('lang') || 'en',
  fallbackLocale: 'en',
  messages,
});

const UI_CHART_TYPES = [
  { type: false, strokeWidth: 0 },
  { type: 'line', strokeWidth: 3 },
  { type: 'area', strokeWidth: 0 },
  { type: 'bar', strokeWidth: 0 },
];

const CHART_COLORS = {
  rx: { light: 'rgba(128,128,128,0.3)', dark: 'rgba(255,255,255,0.3)' },
  tx: { light: 'rgba(128,128,128,0.4)', dark: 'rgba(255,255,255,0.3)' },
  gradient: { light: ['rgba(0,0,0,1.0)', 'rgba(0,0,0,1.0)'], dark: ['rgba(128,128,128,0)', 'rgba(128,128,128,0)'] },
};

new Vue({
  el: '#app',
  components: {
    apexchart: VueApexCharts,
  },
  i18n,
  data: {
    authenticated: null,
    authenticating: false,
    password: null,
    requiresPassword: null,

    clients: null,
    clientsPersist: {},
    clientDelete: null,
    clientCreate: null,
    clientCreateName: '',
    clientCreateExpiresAt: null,
    clientEditName: null,
    clientEditNameId: null,
    clientEditAddress: null,
    clientEditAddressId: null,
    clientEditExpiresAt: null,
    clientEditExpiresAtId: null,
    clientEditTrafficQuota: null,
    clientEditTrafficQuotaId: null,
    clientCreateTrafficQuota: null,
    trafficQuotaEnabled: false,
    telegramEnabled: false,
    telegramSending: false,
    qrcode: null,
    clientStats: null,

    currentRelease: null,
    latestRelease: null,

    uiTrafficStats: false,
    uiSortClients: false,
    clientSortAsc: localStorage.getItem('clientSortAsc') === '1',

    uiChartType: 0,
    uiShowCharts: localStorage.getItem('uiShowCharts') === '1',
    uiTheme: localStorage.theme || 'auto',
    prefersDarkScheme: window.matchMedia('(prefers-color-scheme: dark)'),

    chartOptions: {
      chart: {
        background: 'transparent',
        stacked: false,
        toolbar: {
          show: false,
        },
        animations: {
          enabled: false,
        },
        parentHeightOffset: 0,
        sparkline: {
          enabled: true,
        },
      },
      colors: [],
      stroke: {
        curve: 'smooth',
      },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'vertical',
          shadeIntensity: 0,
          gradientToColors: CHART_COLORS.gradient[this.theme],
          inverseColors: false,
          opacityTo: 0,
          stops: [0, 100],
        },
      },
      dataLabels: {
        enabled: false,
      },
      plotOptions: {
        bar: {
          horizontal: false,
        },
      },
      xaxis: {
        labels: {
          show: false,
        },
        axisTicks: {
          show: false,
        },
        axisBorder: {
          show: false,
        },
      },
      yaxis: {
        labels: {
          show: false,
        },
        min: 0,
      },
      tooltip: {
        enabled: false,
      },
      legend: {
        show: false,
      },
      grid: {
        show: false,
        padding: {
          left: -10,
          right: 0,
          bottom: -15,
          top: -15,
        },
        column: {
          opacity: 0,
        },
        xaxis: {
          lines: {
            show: false,
          },
        },
      },
    },
  },
  methods: {
    dateTime: (value) => {
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
      }).format(value);
    },
    formatExpiresAt(value) {
      if (!value) return 'Permanent';
      const date = new Date(value);
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
      }).format(date);
    },
    formatDateTimeLocal(value) {
      if (!value) return '';
      const date = new Date(value);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    },
    async refresh({
      updateCharts = false,
    } = {}) {
      if (!this.authenticated) return;

      const clients = await this.api.getClients();
      this.clients = clients.map((client) => {
        if (client.name.includes('@') && client.name.includes('.')) {
          client.avatar = `https://gravatar.com/avatar/${sha256(client.name.toLowerCase().trim())}.jpg`;
        }

        if (!this.clientsPersist[client.id]) {
          this.clientsPersist[client.id] = {};
          this.clientsPersist[client.id].transferRxHistory = Array(50).fill(0);
          this.clientsPersist[client.id].transferRxPrevious = client.transferRx;
          this.clientsPersist[client.id].transferTxHistory = Array(50).fill(0);
          this.clientsPersist[client.id].transferTxPrevious = client.transferTx;
        }

        // Debug
        // client.transferRx = this.clientsPersist[client.id].transferRxPrevious + Math.random() * 1000;
        // client.transferTx = this.clientsPersist[client.id].transferTxPrevious + Math.random() * 1000;
        // client.latestHandshakeAt = new Date();
        // this.requiresPassword = true;

        this.clientsPersist[client.id].transferRxCurrent = client.transferRx - this.clientsPersist[client.id].transferRxPrevious;
        this.clientsPersist[client.id].transferRxPrevious = client.transferRx;
        this.clientsPersist[client.id].transferTxCurrent = client.transferTx - this.clientsPersist[client.id].transferTxPrevious;
        this.clientsPersist[client.id].transferTxPrevious = client.transferTx;

        if (updateCharts) {
          this.clientsPersist[client.id].transferRxHistory.push(this.clientsPersist[client.id].transferRxCurrent);
          this.clientsPersist[client.id].transferRxHistory.shift();

          this.clientsPersist[client.id].transferTxHistory.push(this.clientsPersist[client.id].transferTxCurrent);
          this.clientsPersist[client.id].transferTxHistory.shift();

          this.clientsPersist[client.id].transferTxSeries = [{
            name: 'Tx',
            data: this.clientsPersist[client.id].transferTxHistory,
          }];

          this.clientsPersist[client.id].transferRxSeries = [{
            name: 'Rx',
            data: this.clientsPersist[client.id].transferRxHistory,
          }];

          client.transferTxHistory = this.clientsPersist[client.id].transferTxHistory;
          client.transferRxHistory = this.clientsPersist[client.id].transferRxHistory;
          client.transferMax = Math.max(...client.transferTxHistory, ...client.transferRxHistory);

          client.transferTxSeries = this.clientsPersist[client.id].transferTxSeries;
          client.transferRxSeries = this.clientsPersist[client.id].transferRxSeries;
        }

        client.transferTxCurrent = this.clientsPersist[client.id].transferTxCurrent;
        client.transferRxCurrent = this.clientsPersist[client.id].transferRxCurrent;

        client.hoverTx = this.clientsPersist[client.id].hoverTx;
        client.hoverRx = this.clientsPersist[client.id].hoverRx;

        return client;
      });

      // Fetch client statistics
      this.clientStats = await this.api.getClientStats();
    },
    login(e) {
      e.preventDefault();

      if (!this.password) return;
      if (this.authenticating) return;

      this.authenticating = true;
      this.api.createSession({
        password: this.password,
      })
        .then(async () => {
          const session = await this.api.getSession();
          this.authenticated = session.authenticated;
          this.requiresPassword = session.requiresPassword;
          return this.refresh();
        })
        .catch((err) => {
          alert(err.message || err.toString());
        })
        .finally(() => {
          this.authenticating = false;
          this.password = null;
        });
    },
    logout(e) {
      e.preventDefault();

      this.api.deleteSession()
        .then(() => {
          this.authenticated = false;
          this.clients = null;
        })
        .catch((err) => {
          alert(err.message || err.toString());
        });
    },
    createClient() {
      const name = this.clientCreateName;
      if (!name) return;

      const expiresAt = this.clientCreateExpiresAt ? new Date(this.clientCreateExpiresAt).toISOString() : null;

      // Convert GB to bytes for traffic quota
      let trafficQuota = null;
      if (this.clientCreateTrafficQuota && this.clientCreateTrafficQuota !== '') {
        trafficQuota = Math.round(parseFloat(this.clientCreateTrafficQuota) * 1024 * 1024 * 1024);
      }

      this.api.createClient({ name, expiresAt, trafficQuota })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    bytes,
    deleteClient(client) {
      this.api.deleteClient({ clientId: client.id })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    enableClient(client) {
      this.api.enableClient({ clientId: client.id })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    disableClient(client) {
      this.api.disableClient({ clientId: client.id })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    updateClientName(client, name) {
      this.api.updateClientName({ clientId: client.id, name })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    updateClientAddress(client, address) {
      this.api.updateClientAddress({ clientId: client.id, address })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    updateClientExpiresAt(client, expiresAt) {
      // If expiresAt is empty string, send 'PERMANENT' to indicate permanent (null)
      // Otherwise convert to ISO string
      const expiresAtISO = expiresAt ? new Date(expiresAt).toISOString() : 'PERMANENT';
      this.api.updateClientExpiresAt({ clientId: client.id, expiresAt: expiresAtISO })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    updateClientTrafficQuota(client, trafficQuotaGB) {
      // Convert GB to bytes, or 'UNLIMITED' if empty/0
      let trafficQuota;
      if (!trafficQuotaGB || trafficQuotaGB === '' || trafficQuotaGB === '0') {
        trafficQuota = 'UNLIMITED';
      } else {
        trafficQuota = Math.round(parseFloat(trafficQuotaGB) * 1024 * 1024 * 1024);
      }
      this.api.updateClientTrafficQuota({ clientId: client.id, trafficQuota })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    resetClientTraffic(client) {
      if (!confirm(this.$t('confirmResetTraffic'))) return;
      this.api.resetClientTraffic({ clientId: client.id })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    formatTrafficQuota(bytes) {
      if (!bytes) return this.$t('unlimited');
      return this.bytes(bytes);
    },
    trafficQuotaToGB(bytes) {
      if (!bytes) return '';
      return (bytes / (1024 * 1024 * 1024)).toFixed(2);
    },
    getTrafficPercentage(client) {
      if (!client.trafficQuota) return 0;
      return Math.min(100, Math.round((client.trafficUsed / client.trafficQuota) * 100));
    },
    restoreConfig(e) {
      e.preventDefault();
      const file = e.currentTarget.files.item(0);
      if (file) {
        file.text()
          .then((content) => {
            this.api.restoreConfiguration(content)
              .then((_result) => alert('The configuration was updated.'))
              .catch((err) => alert(err.message || err.toString()))
              .finally(() => this.refresh().catch(console.error));
          })
          .catch((err) => alert(err.message || err.toString()));
      } else {
        alert('Failed to load your file!');
      }
    },
    toggleTheme() {
      const themes = ['light', 'dark', 'auto'];
      const currentIndex = themes.indexOf(this.uiTheme);
      const newIndex = (currentIndex + 1) % themes.length;
      this.uiTheme = themes[newIndex];
      localStorage.theme = this.uiTheme;
      this.setTheme(this.uiTheme);
    },
    setTheme(theme) {
      const { classList } = document.documentElement;
      const shouldAddDarkClass = theme === 'dark' || (theme === 'auto' && this.prefersDarkScheme.matches);
      classList.toggle('dark', shouldAddDarkClass);
    },
    handlePrefersChange(e) {
      if (localStorage.theme === 'auto') {
        this.setTheme(e.matches ? 'dark' : 'light');
      }
    },
    toggleCharts() {
      localStorage.setItem('uiShowCharts', this.uiShowCharts ? 1 : 0);
    },
    toggleSortClients() {
      this.clientSortAsc = !this.clientSortAsc;
      localStorage.setItem('clientSortAsc', this.clientSortAsc ? '1' : '0');
    },
    sendTelegramBackup() {
      if (this.telegramSending) return;
      this.telegramSending = true;
      this.api.sendTelegramBackup(true)
        .then((result) => {
          if (result.success) {
            if (result.skipped) {
              alert(this.$t('telegramSkipped'));
            } else {
              alert(this.$t('telegramSuccess'));
            }
          } else {
            alert(`${this.$t('telegramFailed')}: ${result.message}`);
          }
        })
        .catch((err) => alert(`${this.$t('telegramFailed')}: ${err.message || err.toString()}`))
        .finally(() => { this.telegramSending = false; });
    },
  },
  filters: {
    bytes,
    timeago: (value) => {
      return timeago.format(value, i18n.locale);
    },
  },
  mounted() {
    this.prefersDarkScheme.addListener(this.handlePrefersChange);
    this.setTheme(this.uiTheme);

    this.api = new API();
    this.api.getSession()
      .then((session) => {
        this.authenticated = session.authenticated;
        this.requiresPassword = session.requiresPassword;
        this.refresh({
          updateCharts: this.updateCharts,
        }).catch((err) => {
          alert(err.message || err.toString());
        });
      })
      .catch((err) => {
        alert(err.message || err.toString());
      });

    setInterval(() => {
      this.refresh({
        updateCharts: this.updateCharts,
      }).catch(console.error);
    }, 1000);

    this.api.getuiTrafficStats()
      .then((res) => {
        this.uiTrafficStats = res;
      })
      .catch(() => {
        this.uiTrafficStats = false;
      });

    this.api.getChartType()
      .then((res) => {
        this.uiChartType = parseInt(res, 10);
      })
      .catch(() => {
        this.uiChartType = 0;
      });

    this.api.getTrafficQuotaEnabled()
      .then((res) => {
        this.trafficQuotaEnabled = res;
      })
      .catch(() => {
        this.trafficQuotaEnabled = false;
      });

    this.api.getTelegramStatus()
      .then((res) => {
        this.telegramEnabled = res.enabled === true;
      })
      .catch(() => {
        this.telegramEnabled = false;
      });

    this.api.getSortClientsEnabled()
      .then((res) => {
        this.uiSortClients = res === 'true';
      })
      .catch(() => {
        this.uiSortClients = false;
      });

    Promise.resolve().then(async () => {
      const lang = await this.api.getLang();
      if (lang !== localStorage.getItem('lang') && i18n.availableLocales.includes(lang)) {
        localStorage.setItem('lang', lang);
        i18n.locale = lang;
      }

      const currentRelease = await this.api.getRelease();
      const latestRelease = await fetch('https://wg-easy.github.io/wg-easy/changelog.json')
        .then((res) => res.json())
        .then((releases) => {
          const releasesArray = Object.entries(releases).map(([version, changelog]) => ({
            version: parseInt(version, 10),
            changelog,
          }));
          releasesArray.sort((a, b) => {
            return b.version - a.version;
          });

          return releasesArray[0];
        });

      if (currentRelease >= latestRelease.version) return;

      this.currentRelease = currentRelease;
      this.latestRelease = latestRelease;
    }).catch((err) => console.error(err));
  },
  computed: {
    chartOptionsTX() {
      const opts = {
        ...this.chartOptions,
        colors: [CHART_COLORS.tx[this.theme]],
      };
      opts.chart.type = UI_CHART_TYPES[this.uiChartType].type || false;
      opts.stroke.width = UI_CHART_TYPES[this.uiChartType].strokeWidth;
      return opts;
    },
    chartOptionsRX() {
      const opts = {
        ...this.chartOptions,
        colors: [CHART_COLORS.rx[this.theme]],
      };
      opts.chart.type = UI_CHART_TYPES[this.uiChartType].type || false;
      opts.stroke.width = UI_CHART_TYPES[this.uiChartType].strokeWidth;
      return opts;
    },
    updateCharts() {
      return this.uiChartType > 0 && this.uiShowCharts;
    },
    theme() {
      if (this.uiTheme === 'auto') {
        return this.prefersDarkScheme.matches ? 'dark' : 'light';
      }
      return this.uiTheme;
    },
    sortedClients() {
      if (!this.clients) return null;
      if (!this.uiSortClients) return this.clients;
      const sorted = [...this.clients].sort((a, b) => {
        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
      return this.clientSortAsc ? sorted : sorted.reverse();
    },
  },
});

(function () {
  'use strict';

  if (window.__mirKinoPlugin_loaded) return;
  window.__mirKinoPlugin_loaded = true;

  var STORAGE_PREFIX = 'mirkino';
  var SETTINGS_COMPONENT = STORAGE_PREFIX;
  var PANEL_COMPONENT = STORAGE_PREFIX + 'Panel';
  var HUB_COMPONENT = STORAGE_PREFIX + 'Hub';
  var HUB_PREVIEW_LIMIT = 12;

  var SERVERS = [
    { id: 'ru', label: 'RU — ru.mir-kino.pp.ru', url: 'https://ru.mir-kino.pp.ru' },
    { id: 'eu', label: 'EU — eu.mir-kino.pp.ru', url: 'https://eu.mir-kino.pp.ru' },
    { id: 'cf-eu', label: 'CF EU — cf-eu.mir-kino.pp.ru', url: 'https://cf-eu.mir-kino.pp.ru' },
  ];
  var DEFAULT_SERVER = '';
  var DEFAULT_LOGIN = '';
  var DEFAULT_PASSWORD = '';

  var HTTP_TIMEOUT_MS = 15000;
  var TMDB_TIMEOUT_MS = 10000;
  var TMDB_ENRICH_CONCURRENCY = 8;
  var PAGE_SIZE = 48;
  var IMG_PLACEHOLDER = './img/img_load.svg';

  // === КЭШИ (оставлены как в оригинале) ===
  var API_CACHE_TTL_MS = 30 * 60 * 1000;
  var API_USERDATA_TTL_MS = 3 * 60 * 1000;
  var API_LATEST_TTL_MS = 5 * 60 * 1000;
  var API_VIEWS_TTL_MS = 2 * 60 * 60 * 1000;
  var API_CACHE_MAX_ENTRIES = 72;
  var LIBRARY_INDEX_TTL_MS = 10 * 60 * 1000;
  var VIEWS_CACHE_TTL_MS = API_VIEWS_TTL_MS;
  var TMDB_META_TTL_MS = 24 * 60 * 60 * 1000;
  var TMDB_META_MAX_ENTRIES = 400;

  var RELEASE_FOLDER_RE =
    /(Season\s*\d+)|(S\d{1,2}\s*E\d{0,2}\s*WEB)|WEB-DL|WEBRip|BluRay|2160p|1080p|720p|HDR10|HDR\b|\bDV\b|NOIR\s+VER|COLOR\s+VER|x265|x264/i;

  var MANIFEST = {
    type: 'video',
    version: '1.0.14', // обновил версию
    author: '@pavelpikta',
    name: 'Mir Kino',
    description: 'Browse and play your Mir Kino library in Lampa (с поддержкой статического кэша)',
    component: SETTINGS_COMPONENT,
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 16h.01"/><path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M21.946 12.013H2.054"/><path d="M6 16h.01"/></svg>',
  };

  var FULLSTART_BTN_ICON = '<svg class="mirkino-fullstart__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 16h.01"/><path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M21.946 12.013H2.054"/><path d="M6 16h.01"/></svg>';
  var HEAD_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 16h.01"/><path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M21.946 12.013H2.054"/><path d="M6 16h.01"/></svg>';

  var cachedUserId = '';
  var cachedAccessToken = '';
  var authInflight = null;
  var libraryIndex = { byTmdb: {}, loadedAt: 0 };
  var viewsCache = { list: [], loadedAt: 0 };
  var tmdbMetaCache = {};
  var tmdbPosterInflight = {};
  var apiResponseCache = {};
  var apiCacheOrder = [];
  var apiInflight = {};
  var apiCacheEpoch = 0;
  var libraryIndexInflight = null;
  var hubDataInflight = null;

  // ===================== СТАТИЧЕСКИЙ КЭШ (НОВОЕ) =====================
  var staticCacheEnabled = false;
  var staticCacheUrl = '';
  var staticLibraryCache = null;
  var staticCacheLoading = null;

  function isStaticCacheMode() {
    try {
      return Lampa.Storage.field(STORAGE_PREFIX + 'UseStaticCache') === true;
    } catch (e) { return false; }
  }

  function getStaticCacheUrl() {
    return storageStr('StaticCacheUrl', '');
  }

  function loadStaticLibraryCache() {
    if (staticLibraryCache) return Promise.resolve(staticLibraryCache);
    if (staticCacheLoading) return staticCacheLoading;

    var url = getStaticCacheUrl();
    if (!url) return Promise.reject(new Error('Static cache URL is not set'));

    staticCacheLoading = new Promise(function (resolve, reject) {
      var net = network();
      var done = function (data) {
        staticLibraryCache = data;
        resolve(data);
      };
      var fail = function () {
        staticCacheLoading = null;
        reject(new Error('Failed to load static cache'));
      };

      if (net) {
        net.timeout(20000);
        net.silent(url, done, fail, null, { dataType: 'json' });
      } else {
        Lampa.Network.silent(url, done, fail, null, { dataType: 'json', timeout: 20000 });
      }
    });

    return staticCacheLoading;
  }

  // ===================== ОСНОВНЫЕ ФУНКЦИИ =====================

  function storageStr(suffix, fallback) {
    try {
      var v = String(Lampa.Storage.get(STORAGE_PREFIX + suffix) || '').trim() ||
              String(Lampa.Storage.field(STORAGE_PREFIX + suffix) || '').trim();
      if (v) return v;
    } catch (e) {}
    return fallback == null ? '' : String(fallback);
  }

  function storageToggle(suffix, defaultOn) {
    try {
      var v = Lampa.Storage.field(STORAGE_PREFIX + suffix);
      if (v === true) return true;
      if (v === false) return false;
    } catch (e) {}
    return defaultOn !== false;
  }

  function normalizeBase(raw) {
    var s = String(raw || '').trim().replace(/\/+$/, '');
    if (!s.length) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    return s;
  }

  function serverById(id) {
    for (var i = 0; i < SERVERS.length; i++) {
      if (SERVERS[i].id === id) return SERVERS[i];
    }
    return SERVERS[0];
  }

  function buildServerValues() {
    var values = {};
    SERVERS.forEach(function (server) {
      values[server.id] = server.label;
    });
    return values;
  }

  function apiBase() {
    return normalizeBase(serverById(storageStr('Server', DEFAULT_SERVER)).url);
  }

  function loginName() {
    return storageStr('Login', DEFAULT_LOGIN);
  }

  function loginPassword() {
    return storageStr('Password', DEFAULT_PASSWORD);
  }

  function accessToken() {
    return cachedAccessToken || storageStr('Token', '');
  }

  function embyAuthHeader() {
    return 'MediaBrowser Client="Lampa", Device="Lampa", DeviceId="' + getDeviceId() + '", Version="' + MANIFEST.version + '"';
  }

  // === КЭШ API (оставлен как в оригинале) ===
  function apiCacheKey(url) { return apiCacheEpoch + '|' + String(url || ''); }
  function apiCacheTtl(url) {
    var u = String(url || '');
    if (/\/Items\/Resume(?:\?|$)/i.test(u)) return 0;
    if (/MediaSources/i.test(u)) return 0;
    if (/\/PlayedItems\//i.test(u)) return 0;
    if (/\/Items\/Latest/i.test(u)) return API_LATEST_TTL_MS;
    if (/\/Views(?:\?|$)/i.test(u)) return API_VIEWS_TTL_MS;
    if (/UserData/i.test(u)) return API_USERDATA_TTL_MS;
    return API_CACHE_TTL_MS;
  }

  function trimApiCache() {
    while (apiCacheOrder.length > API_CACHE_MAX_ENTRIES) {
      var oldKey = apiCacheOrder.shift();
      delete apiResponseCache[oldKey];
    }
  }

  function readApiCache(url) {
    var ttl = apiCacheTtl(url);
    if (!ttl) return null;
    var key = apiCacheKey(url);
    var entry = apiResponseCache[key];
    if (!entry) return null;
    if (Date.now() - entry.loadedAt > ttl) {
      delete apiResponseCache[key];
      apiCacheOrder = apiCacheOrder.filter(function (k) { return k !== key; });
      return null;
    }
    return entry.data;
  }

  function writeApiCache(url, data) {
    if (!apiCacheTtl(url)) return;
    var key = apiCacheKey(url);
    if (apiResponseCache[key]) {
      apiCacheOrder = apiCacheOrder.filter(function (k) { return k !== key; });
    }
    apiResponseCache[key] = { data: data, loadedAt: Date.now() };
    apiCacheOrder.push(key);
    trimApiCache();
  }

  function resetApiCacheStore() {
    apiResponseCache = {};
    apiCacheOrder = [];
    apiInflight = {};
  }

  function clearApiCache() {
    apiCacheEpoch++;
    resetApiCacheStore();
  }

  function invalidateUserDataCaches() {
    apiCacheEpoch++;
    resetApiCacheStore();
    libraryIndex.loadedAt = 0;
    libraryIndexInflight = null;
    hubDataInflight = null;
  }

  // ===================== АВТОРИЗАЦИЯ =====================
  function authenticate(force) {
    if (!force && accessToken() && storedUserId()) {
      cachedAccessToken = accessToken();
      cachedUserId = storedUserId();
      return Promise.resolve({ token: cachedAccessToken, userId: cachedUserId });
    }
    if (authInflight) return authInflight;

    var base = apiBase();
    var user = loginName();
    var pw = loginPassword();
    if (!base || !user || !pw) {
      return Promise.reject(new Error(Lampa.Lang.translate('mirkino_auth_required')));
    }

    authInflight = new Promise(function (resolve, reject) {
      $.ajax({
        url: base + '/Users/AuthenticateByName',
        type: 'POST',
        timeout: HTTP_TIMEOUT_MS,
        dataType: 'json',
        contentType: 'application/json',
        headers: { 'X-Emby-Authorization': embyAuthHeader() },
        data: JSON.stringify({ Username: user, Pw: pw }),
      })
      .done(function (data) {
        var token = data && data.AccessToken;
        var uid = data && data.User && data.User.Id;
        var label = (data && data.User && data.User.Name) || user;
        if (!token || !uid) {
          reject(new Error('Authentication failed'));
          return;
        }
        cachedAccessToken = token;
        cachedUserId = String(uid);
        Lampa.Storage.set(STORAGE_PREFIX + 'Token', token);
        Lampa.Storage.set(STORAGE_PREFIX + 'UserId', String(uid));
        Lampa.Storage.set(STORAGE_PREFIX + 'UserLabel', label);
        resolve({ token: token, userId: String(uid) });
      })
      .fail(function (err) {
        var msg = (err && err.responseJSON && (err.responseJSON.title || err.responseJSON.Message)) || 'Authentication failed';
        reject(new Error(msg));
      })
      .always(function () { authInflight = null; });
    });
    return authInflight;
  }

  var netInstance = null;
  function network() {
    if (!netInstance && Lampa.Reguest) netInstance = new Lampa.Reguest();
    return netInstance;
  }

  // ===================== ОСНОВНОЙ HTTP ЗАПРОС =====================
  function jfHttp(path, opts) {
    opts = opts || {};
    return authenticate(false).then(function () {
      var base = apiBase();
      var key = accessToken();
      if (!base || !key) return Promise.reject(new Error(Lampa.Lang.translate('mirkino_auth_required')));

      var p = String(path || '');
      var url = base + (p.charAt(0) === '/' ? p : '/' + p);
      var sep = url.indexOf('?') >= 0 ? '&' : '?';
      if (url.indexOf('api_key=') < 0) url += sep + 'api_key=' + encodeURIComponent(key);

      var timeout = typeof opts.timeout === 'number' ? opts.timeout : HTTP_TIMEOUT_MS;
      var dataType = opts.dataType || 'json';
      var method = (opts.method || 'GET').toUpperCase();
      var useJsonAjax = opts.jsonBody !== undefined || method === 'DELETE';
      var useCache = method === 'GET' && !useJsonAjax && opts.cache !== false;

      if (useCache) {
        var cached = readApiCache(url);
        if (cached !== null) return Promise.resolve(cached);
        if (apiInflight[apiCacheKey(url)]) return apiInflight[apiCacheKey(url)];
      }

      var request = new Promise(function (resolve, reject) {
        function ok(raw) {
          if (dataType === 'json' && typeof raw === 'string' && raw.length) {
            try { raw = JSON.parse(raw); } catch (e) {}
          }
          if (useCache) writeApiCache(url, raw);
          resolve(raw);
        }
        function fail(err) {
          var msg = (err && (err.decode_error || err.responseText || err.statusText)) || 'Request failed';
          reject(new Error(msg));
        }

        if (useJsonAjax) {
          $.ajax({
            url: url, type: method, timeout: timeout, dataType: dataType,
            contentType: 'application/json',
            data: opts.jsonBody !== undefined ? JSON.stringify(opts.jsonBody) : undefined
          }).done(ok).fail(fail);
        } else if (!network()) {
          Lampa.Network.silent(url, ok, fail, null, { timeout: timeout, dataType: dataType });
        } else {
          var net = network();
          net.timeout(timeout);
          net.silent(url, ok, fail, null, { timeout: timeout, dataType: dataType });
        }
      });

      if (useCache) {
        var inflightKey = apiCacheKey(url);
        apiInflight[inflightKey] = request.finally(function () { delete apiInflight[inflightKey]; });
        return apiInflight[inflightKey];
      }
      return request;
    });
  }

  // ===================== СТАТИЧЕСКИЙ КЭШ — ЗАМЕНА ЗАПРОСОВ =====================
  function fetchLibraryViews(force) {
    if (isStaticCacheMode()) {
      return loadStaticLibraryCache().then(function (cache) {
        var list = cache.views || [];
        viewsCache.list = list;
        viewsCache.loadedAt = Date.now();
        return list;
      }).catch(function () {
        return fetchLibraryViewsOriginal(force);
      });
    }
    return fetchLibraryViewsOriginal(force);
  }

  var fetchLibraryViewsOriginal = (function () {
    // оригинальная реализация (сокращённая для примера, в реальном файле — полная)
    return function (force) {
      if (!force && viewsCache.loadedAt && Date.now() - viewsCache.loadedAt < VIEWS_CACHE_TTL_MS) {
        return Promise.resolve(viewsCache.list);
      }
      return resolveUserId().then(function (userId) {
        return jfHttp('/Users/' + encodeURIComponent(userId) + '/Views');
      }).then(function (data) {
        var list = [];
        ((data && data.Items) || []).forEach(function (item) {
          list.push({
            id: item.Id,
            title: item.Name || item.Id,
            collectionType: item.CollectionType || '',
            childCount: item.ChildCount || 0,
            poster: viewPosterUrl(item),
            raw: item
          });
        });
        viewsCache.list = list;
        viewsCache.loadedAt = Date.now();
        return list;
      });
    };
  })();

  function fetchItems(category, startIndex) {
    if (isStaticCacheMode()) {
      return loadStaticLibraryCache().then(function (cache) {
        var data = cache.data || {};
        var key = category;
        var result = data[key] || { Items: [], TotalRecordCount: 0 };
        var items = result.Items || [];
        return processRows(items.slice(startIndex || 0, (startIndex || 0) + PAGE_SIZE), category).then(function (rows) {
          return {
            rows: rows,
            total: result.TotalRecordCount || items.length,
            next: (startIndex || 0) + rows.length,
            hasMore: (startIndex || 0) + rows.length < (result.TotalRecordCount || items.length)
          };
        });
      }).catch(function () {
        return fetchItemsOriginal(category, startIndex);
      });
    }
    return fetchItemsOriginal(category, startIndex);
  }

  var fetchItemsOriginal = (function () {
    // оригинальная реализация (сокращённая)
    return function (category, startIndex) {
      return resolveUserId().then(function (userId) {
        if (category === 'Latest') return fetchLatest(userId);
        // ... остальная логика оригинального fetchItems ...
        return jfHttp('/Items?UserId=' + userId + '&Recursive=true&IncludeItemTypes=Movie,Series&StartIndex=' + (startIndex || 0) + '&Limit=' + PAGE_SIZE).then(function (data) {
          var items = data.Items || [];
          return processRows(items, category).then(function (rows) {
            return { rows: rows, total: data.TotalRecordCount || items.length, next: (startIndex || 0) + items.length, hasMore: items.length === PAGE_SIZE };
          });
        });
      });
    };
  })();

  // ===================== ИСПРАВЛЕНИЕ ВИДИМОСТИ В АДМИНКЕ JELLYFIN =====================
  function streamUrl(itemId, opts) {
    opts = opts || {};
    var id = String(itemId || '');
    if (!id) return '';

    var msId = opts.mediaSourceId ? String(opts.mediaSourceId) : id;

    var parts = [
      'DeviceId=' + encodeURIComponent(getDeviceId()),
      'MediaSourceId=' + encodeURIComponent(mediaSourceId(msId)),
      'api_key=' + encodeURIComponent(accessToken())
      // 'Static=true' — УБРАНО!
    ];

    if (opts.userId) parts.push('UserId=' + encodeURIComponent(opts.userId));
    if (opts.startTicks > 0) parts.push('StartTimeTicks=' + encodeURIComponent(String(opts.startTicks)));

    // Добавляем PlaySessionId — важно для отображения в админке
    var playSessionId = opts.playSessionId || ('mirkino-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9));
    parts.push('PlaySessionId=' + encodeURIComponent(playSessionId));

    return apiBase() + '/Videos/' + encodeURIComponent(id) + '/stream?' + parts.join('&');
  }

  // ===================== ОСТАЛЬНОЙ КОД ПЛАГИНА (сокращённо для примера) =====================
  // В реальном файле здесь идёт весь остальной код: mapRow, processRows, PanelComponent, HubComponent и т.д.
  // Для brevity здесь оставлена только структура. Полный файл можно собрать из оригинала + эти изменения.

  function init() {
    if (window.lampa_settings && window.lampa_settings.read_only) return;

    addLang();
    registerStyles();
    $('body').append(Lampa.Template.get('mirkino_style', {}, true));

    Lampa.Component.add(PANEL_COMPONENT, PanelComponent);
    Lampa.Component.add(HUB_COMPONENT, HubComponent);
    Lampa.Manifest.plugins = MANIFEST;
    addSettings();
    registerMenuButtons();
    injectHeadIcon();
    listenFullCard();

    if (loginName() && loginPassword()) {
      authenticate(false).then(function () {
        return fetchLibraryViews(false);
      }).catch(function () {});
    }
  }

  if (window.appready) init();
  else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });

  // ===================== ДОБАВЛЕНИЕ НАСТРОЕК СТАТИЧЕСКОГО КЭША =====================
  function addSettings() {
    Lampa.SettingsApi.addComponent({
      component: SETTINGS_COMPONENT,
      name: Lampa.Lang.translate('mirkino_settings_name'),
      icon: MANIFEST.icon
    });

    // ... все остальные настройки ...

    Lampa.SettingsApi.addParam({
      component: SETTINGS_COMPONENT,
      param: { type: 'trigger', default: false, name: STORAGE_PREFIX + 'UseStaticCache' },
      field: { name: 'Use static library cache (рекомендуется)' },
      onChange: function () {
        staticLibraryCache = null;
        Lampa.Settings.update();
      }
    });

    Lampa.SettingsApi.addParam({
      component: SETTINGS_COMPONENT,
      param: { name: STORAGE_PREFIX + 'StaticCacheUrl', type: 'input', default: '' },
      field: { name: 'Static cache JSON URL' },
      onChange: function () { staticLibraryCache = null; }
    });
  }

  // Полный код оригинального плагина + вышеуказанные изменения
  // (в реальном использовании замените этот файл на полный с применёнными патчами)
})();

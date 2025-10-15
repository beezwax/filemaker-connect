import _ from 'lodash';
import parseResponse from './parse-response.js';
import Token, { events as tokenEvents } from './token.js';

export const events = {
  ERROR: 'error',
  INVALID_TOKEN: 'invalid-token',
  REQUEST: 'request',
  INFO: 'info',
  RESPONSE: 'response',
  RESPONSE_SUCCESS: 'response-success',
  TOKEN_FETCH: 'token-fetch',
  TOKEN_DESTROY: 'token-destroy',
  TOKEN_REFRESH: 'token-refresh',
  TOKEN_COGNITO_REFRESH: 'token-cognito-refresh',
};

export default class FilemakerConnect {
  constructor(params) {
    this.username = params.username;
    this.password = params.password;
    this.db = params.db;
    this.server = params.server;
    this.timeout = Number(params.timeout);
    this.tokenRefreshInterval = Number(params.tokenRefreshInterval);
    this.clarisRefreshToken = params.clarisRefreshToken;
    this.tokenPool = [];
    this.currentTokenIndex = 0;
    this.callbacks = Object.fromEntries(Object.values(events).map(name => [name, []]));
  }

  on(eventName, callback) {
    if (!Object.keys(this.callbacks).includes(eventName)) {
      throw new Error(`Event ${eventName} not found`);
    }
    this.callbacks[eventName].push(callback);
  }

  dispatch(eventName, data) {
    this.callbacks[eventName].forEach(cb => cb(data));
  }

  async getToken() {
    const ttlOffset = _.ceil(Math.random(), 1) * 60_000;
    const token = new Token({
      username: this.username,
      password: this.password,
      baseUrl: this.#baseUrl,
      ttl: this.tokenRefreshInterval + ttlOffset,
      useClarisId: this.server.includes('filemaker-cloud.com'),
      clarisRefreshToken: this.clarisRefreshToken
    });

    token.on(tokenEvents.ERROR, data => this.dispatch(events.ERROR, data));
    token.on(tokenEvents.FETCH, data => this.dispatch(events.TOKEN_FETCH, data));
    token.on(tokenEvents.DESTROY, data => this.dispatch(events.TOKEN_DESTROY, data));
    token.on(tokenEvents.REFRESH, data => this.dispatch(events.TOKEN_REFRESH, data));
    token.on(tokenEvents.COGNITO_REFRESH, data => this.dispatch(events.TOKEN_COGNITO_REFRESH, data));

    await token.fetch();
    this.tokenPool.push(token);
  }

  /**
   * @param {Object} params
   * @param {String} params.layout
   * @param {Number} [params.limit]
   * @param {Number} [params.offset]
   * @param {Object} [params.query]
   * @param {Array<Array<String>>} [params.sort]
   * @param {Number} [params.timeout]
   * @returns {Promise<Array<Object>>}
   */
  async findAll(params) {
    const {
      layout,
      limit = 9999,
      offset,
      rejectOnEmpty = false,
      query = [],
      sort,
      timeout,
      ...otherOptions
    } = params;
    let res;
    this.dispatch(events.INFO, { message: 'logger for findAll', ...params });
    if (query.some(q => Object.keys(q).length)) {
      res = await this.#request({
        ...params,
        url: `/layouts/${layout}/_find`,
        method: 'POST',
        rejectOnEmpty,
        ...(timeout && { timeout }),
        body: {
          query,
          limit,
          ...(offset && { offset }),
          ...(sort && { sort }),
          ...otherOptions,
        },
      });
    } else {
      const searchParams = this.#formatSearchParams({ limit, offset, sort });
      res = await this.#request({
        ...params,
        url: `/layouts/${layout}/records?${searchParams}`,
        method: 'GET',
        rejectOnEmpty,
        ...(timeout && { timeout }),
      });
    }

    return res;
  }

  /**
   * @param {Object} params
   * @param {String} params.layout
   * @param {Number|String} params.recordId
   * @param {Number} [params.timeout]
   * @returns {Promise<Object>}
   */
  async findByRecordId(params) {
    const { layout, recordId } = params;
    const res = await this.#request({
      ...params,
      url: `/layouts/${layout}/records/${recordId}`,
      method: 'GET',
    });

    return res.data[0];
  }

  /**
   *
   * @param {Object} params
   * @param {String} params.layout
   * @param {Object} params.fieldData
   * @param {Object} [params.portalData]
   * @param {Object} [params.script]
   * @param {Number} [params.timeout]
   * @returns {Promise<Number>}
   */
  async create(params) {
    const { layout, fieldData, portalData } = params;
    const response = await this.#request({
      ...params,
      url: `/layouts/${layout}/records`,
      method: 'POST',
      body: { fieldData, ...(portalData && { portalData }) },
    });

    return Number(response.recordId);
  }

  /**
   *
   * @param {Object} params
   * @param {Number|String} params.recordId
   * @param {String} params.layout
   * @param {Object} [params.fieldData]
   * @param {Object} [params.portalData]
   * @param {Object} [params.script]
   * @param {Number} [params.timeout]
   * @returns {Promise<Object>}
   */
  async update(params) {
    const { recordId, layout, fieldData, portalData } = params;
    return this.#request({
      ...params,
      url: `/layouts/${layout}/records/${recordId}`,
      method: 'PATCH',
      body: { fieldData, portalData },
    });
  }

  /**
   *
   * @param {Object} params
   * @param {String} params.layout
   * @param {Number|String} params.recordId
   * @param {Object} params.script
   * @param {Number} [params.timeout]
   * @returns {Promise<Object>}
   */
  async delete(params) {
    const { layout, recordId } = params;
    return this.#request({
      ...params,
      url: `/layouts/${layout}/records/${recordId}`,
      method: 'DELETE',
    });
  }

  /**
   *
   * @param {Object} params
   * @param {String} params.layout
   * @param {String} params.script
   * @param {String} params.param
   * @param {Number} [params.timeout]
   * @returns {Promise<Object>}
   */
  async runScript(params) {
    const { layout, script, param, timeout } = params;
    let url = `/layouts/${layout}/script/${script}`;

    if (param) {
      url += `?script.param=${param}`;
    }

    return this.#request({ ...params, url, method: 'GET', timeout });
  }

  async getLayouts() {
    const { layouts } = await this.#request({ url: '/layouts', method: 'GET' });
    return layouts;
  }

  async getLayout(name) {
    return this.#request({ url: `/layouts/${name}`, method: 'GET' });
  }

  // private

  #getAndRotateToken() {
    this.currentTokenIndex++;
    if (this.currentTokenIndex >= this.tokenPool.length) {
      this.currentTokenIndex = 0;
    }
    return this.tokenPool[this.currentTokenIndex];
  }

  get #baseUrl() {
    return `${this.server}/fmi/data/v2/databases/${encodeURIComponent(this.db)}`;
  }

  /**
   * @param {Object} params
   * @param {String} params.url
   * @param {String} params.method
   * @param {Object} [params.body]
   * @param {Boolean} [params.rejectOnEmpty]
   * @param {Object} [params.script]
   * @param {Number} [params.timeout]
   * @param {Boolean} [retry]
   * @param {String} [tokenRetry]
   * @returns {Promise<Array<Object>>}
   */
  async #request(params, retry = false) {
    const { url, method, rejectOnEmpty, script, timeout } = params;
    let { body } = params;
    const start = performance.now();
    body = { ...body, ...this.#formatScriptParam(script) };

    if (!this.tokenPool.length) {
      await this.getToken();
    }

    const token = this.#getAndRotateToken();
    const response = await this.#fetchWithLogging(`${this.#baseUrl}${url}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      method,
      ...(Object.keys(body).length && { body: JSON.stringify(body) }),
      ...(typeof timeout !== 'undefined' && { timeout }),
    }, params);

    const responseData = await parseResponse(response);

    if (!response.ok) {
      if (responseData.messages?.[0]?.code === '952' && !retry) {
        this.dispatch(events.INVALID_TOKEN, {
          token,
          response,
          responseData,
          time: performance.now() - start,
          options: params,
        });
        await token.refresh();
        return this.#request(params, true);
      } else if (responseData.messages?.[0]?.code === '401' && !rejectOnEmpty) {
        return Promise.resolve({ data: [] });
      }

      const cause = responseData.messages?.map(m => `Code:${m.code} - ${m.message}`).join(' ');
      this.dispatch(events.ERROR, {
        token,
        response,
        responseData,
        cause,
        time: performance.now() - start,
        options: params,
      });
      throw new Error('Unhandled FileMaker Data API Error', { cause });
    }

    this.dispatch(events.RESPONSE_SUCCESS, {
      token,
      response,
      responseData,
      time: performance.now() - start,
      options: params,
    })

    return responseData.response;
  }

  async #fetchWithLogging(url, options, originalParams) {
    const start = performance.now();
    this.dispatch(events.REQUEST, { url, options: { ...options, ...originalParams } });

    if (typeof options.timeout !== 'undefined') {
      if (Number(options.timeout)) {
        options.signal ||= AbortSignal.timeout(Number(options.timeout));
      }
    } else if (this.timeout) {
      options.signal ||= AbortSignal.timeout(this.timeout);
    }

    const response = await fetch(url, options);

    this.dispatch(events.RESPONSE, {
      response,
      url: `${url}`,
      options: { ...options, ...originalParams },
      time: performance.now() - start,
    });

    return response;
  }

  #formatSearchParams(query) {
    const searchParams = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (![null, undefined].includes(v)) {
        const formattedValue = typeof v === 'object' ? JSON.stringify(v) : v.toString();
        searchParams.set(`_${k}`, formattedValue);
      }
    });
    return searchParams.toString();
  }

  #formatScriptParam(script) {
    if (!script?.name) {
      return {};
    }

    const nameProp = ['script', script.type].filter(Boolean).join('.');
    const body = {
      [nameProp]: script.name,
    };
    if (script.hasOwnProperty('param')) {
      body[`${nameProp}.param`] = script.param;
    }

    return body;
  }
}

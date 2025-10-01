import { performance } from 'node:perf_hooks';
import parseResponse from './parse-response.js';
import fetchCognitoToken, { refreshToken } from './fetch-cognito-token.js';

export const events = {
  FETCH: 'fetch',
  DESTROY: 'destroy',
  REFRESH: 'refresh',
  COGNITO_REFRESH: 'cognito-refresh',
  ERROR: 'error',
};

export default class Token {
  constructor({ clarisRefreshToken, username, password, baseUrl, ttl, useClarisId = false }) {
    this.username = username;
    this.password = password;
    this.baseUrl = baseUrl;
    this.ttl = ttl;
    this.callbacks = Object.fromEntries(Object.values(events).map(name => [name, []]));
    this.useClarisId = useClarisId
    this.clarisRefreshToken = clarisRefreshToken;
  }

  toString() {
    return this.token;
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

  authHeaders() {
    if (this.useClarisId) {
      return {
        Authorization: `FMID ${this.clarisIdToken}`,
        'Content-Type': 'application/json',
      };
    }
    const encodedAuth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    return {
      Authorization: `Basic ${encodedAuth}`,
      'Content-Type': 'application/json',
    };
  }

  async fetchCognito() {
    const start = performance.now();
    let didRefresh = false;
    if (this.clarisRefreshToken) {
      try {
        this.clarisIdToken = await refreshToken(this.username, this.clarisRefreshToken);
        return;
      } catch (err) {
        if (err.code === 'NotAuthorizedException') {
          didRefresh = true;
        } else {
          throw err;
        }
      }
    }

    const {
      cognitoAccessToken,
      clarisIdToken,
      clarisRefreshToken,
    } = await fetchCognitoToken(this.username, this.password);
    this.cognitoAccessToken = cognitoAccessToken;
    this.clarisIdToken = clarisIdToken;
    this.clarisRefreshToken = clarisRefreshToken;
    if (didRefresh) {
      this.dispatch(events.COGNITO_REFRESH, {
        clarisRefreshToken: this.clarisRefreshToken,
        time: performance.now() - start,
      });
    }
  }

  async fetch() {
    if (this.useClarisId) {
      await this.fetchCognito();
    }

    const start = performance.now();
    try {
      const response = await fetch(`${this.baseUrl}/sessions`, {
        method: 'POST',
        headers: this.authHeaders(),
      });

      if (!response.ok) {
        console.log(response.status, response.statusText);
      }

      const responseData = await parseResponse(response);

      if (this.ttl) {
        setTimeout(this.refresh.bind(this), this.ttl);
      }

      if (response.ok) {
        this.token = response.headers.get('X-FM-Data-Access-Token');
        this.dispatch(events.FETCH, {
          token: this.token,
          response: responseData,
          responseStatus: response.status,
          time: performance.now() - start,
        });
        return true;
      } else {
        this.dispatch(events.ERROR, {
          token: this.token,
          response: responseData,
          responseStatus: response.status,
          time: performance.now() - start,
        });
        return false;
      }
    } catch (error) {
      this.dispatch(events.ERROR, {
        token: this.token,
        error,
        time: performance.now() - start,
      });
      return false;
    }
  }

  async destroy(token) {
    const start = performance.now();
    try {
      const response = await fetch(`${this.baseUrl}/sessions/${token}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      const responseData = await parseResponse(response);

      if (response.ok) {
        this.dispatch(events.DESTROY, {
          token,
          response: responseData,
          responseStatus: response.status,
          time: performance.now() - start,
        });
      } else {
        this.dispatch(events.ERROR, {
          action: 'destroy',
          token: this.token,
          response: responseData,
          responseStatus: response.status,
          time: performance.now() - start,
        });
      }
    } catch (error) {
      this.dispatch(events.ERROR, {
        action: 'destroy',
        token: this.token,
        error,
        time: performance.now() - start,
      });
    }
  }

  async refresh() {
    const oldToken = this.token;

    await this.fetch();
    await this.destroy(oldToken);
  }
}

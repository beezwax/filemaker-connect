import { performance } from 'node:perf_hooks';
import parseResponse from './parse-response.js';

const events = {
  FETCH: 'fetch',
  DESTROY: 'destroy',
  REFRESH: 'refresh',
  ERROR: 'error',
};

export default class Token {
  constructor({ username, password, baseUrl, ttl }) {
    this.username = username;
    this.password = password;
    this.baseUrl = baseUrl;
    this.ttl = ttl;
    this.callbacks = Object.fromEntries(Object.values(events).map(name => [name, []]));
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
    const encodedAuth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    return {
      Authorization: `Basic ${encodedAuth}`,
      'Content-Type': 'application/json',
    };
  }

  async fetch() {
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
        this.dispatch('fetch', {
          token: this.token,
          response: responseData,
          responseStatus: response.status,
          time: performance.now() - start,
        });
        return true;
      } else {
        this.dispatch('error', {
          token: this.token,
          response: responseData,
          responseStatus: response.status,
          time: performance.now() - start,
        });
        return false;
      }
    } catch (error) {
      this.dispatch('error', {
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
        this.dispatch('destroy', {
          token,
          response: responseData,
          responseStatus: response.status,
          time: performance.now() - start,
        });
      } else {
        this.dispatch('error', {
          action: 'destroy',
          token: this.token,
          response: responseData,
          responseStatus: response.status,
          time: performance.now() - start,
        });
      }
    } catch (error) {
      this.dispatch('error', {
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

'use babel';

import config from '../config';
import store from '../store';
import * as util from '../util';

const _ = require('lodash');
const request = require('request');

// 1 hour
const REFRESH_INTERVAL_TIME = 1000 * 60 * 60;

export default class SnippetsService {
  refreshInterval: null;
  initialized: false;
  notification: null;

  constructor() {
    this.initialized = false;
  }

  initialize() {
    this.fetchSnippets();

    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    this.refreshInterval = setInterval(
      () => this.fetchSnippets(false),
      REFRESH_INTERVAL_TIME
    );
  }

  fetchSnippets(showNotification = true) {
    if (!util.credentialsExist()) {
      return;
    }

    request({
      method: 'GET',
      url: `${config.apiHost}/atom/snippets`,
      headers: this.requestHeaders(),
      strictSSL: config.env === 'production'
    }, (error, response, body) => {
      if (error) {
        return;
      }

      let json = JSON.parse(body);
      store.personalLibrary = json.personalLibrary;

      this.setSnippets(json);
      this.setTeams(json);

      this.initialized = true;

      if (showNotification) {
        this.notification =
          atom.notifications.addSuccess(
            'Cacher snippets loaded.'
          );
      }
    });
  }

  createSnippet(attrs, success, failure) {
    if (!util.credentialsExist()) {
      return;
    }

    let {
      title, description, isPrivate, filename, content, filetype, libraryGuid
    } = attrs;

    let body =
      {
        snippet: {
          title,
          description,
          isPrivate,
          files: [
            {
              filename,
              content,
              filetype,
              isShared: false
            }
          ]
        },
        labels: attrs.labelGuids,
        libraryGuid
    };

    request({
      method: 'POST',
      url: `${config.apiHost}/atom/snippets`,
      headers: this.requestHeaders(),
      body,
      json: true,
      strictSSL: config.env === 'production'
    }, (error, response, body) => {
      if (response.statusCode === 200) {
        success(body.snippet);

        // Need to update library
        this.fetchSnippets(false);
      } else {
        console.error(response);
        failure(response);
      }
    });
  }

  setSnippets(response) {
    let labels = response.personalLibrary.labels;

    let personalSnippets = _.map(
      response.personalLibrary.snippets,
      (snippet) => {
        // Personal snippet
        let newSnippet = _.clone(snippet);
        newSnippet.team = null;

        // Find labels
        newSnippet.labels = this.snippetLabels(labels, snippet);
        return newSnippet;
      }
    );

    let teamSnippets = [];

    _.each(response.teams, (team) => {
      let labels = team.library.labels;

      _.each(team.library.snippets, (snippet) => {
        let newSnippet = _.clone(snippet);
        newSnippet.team = team;

        newSnippet.labels = this.snippetLabels(labels, snippet);
        teamSnippets.push(newSnippet);
      });
    });

    store.snippets = personalSnippets.concat(teamSnippets);
  }

  snippetLabels(labels, snippet) {
    return _.map(
      _.filter(labels, (label) => {
        return _.find(label.snippets, {
          guid: snippet.guid
        });
      }),
      (label) => label.title
    );
  }

  setTeams(response) {
    store.teams = response.teams;

    store.teamsEditable =
      _.filter(store.teams, (team) => {
        return team.userRole === 'owner'
          || team.userRole === 'manager'
          || team.userRole === 'member';
      });
  }

  requestHeaders() {
    let credentials = util.getCredentials();

    return {
      'X-Api-Key': credentials.key,
      'X-Api-Token': credentials.token
    };
  }

  dispose() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    if (this.notification) {
      this.notification.dismiss();
    }
  }
}

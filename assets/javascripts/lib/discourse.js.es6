import { debounce } from "@ember/runloop";
import { ajax } from "discourse/lib/ajax";
import { Promise } from "rsvp";
import {
  DB_NAME,
  DB_VERSION,
  loadDbIdentity,
  saveDbIdentity
} from "discourse/plugins/discourse-encrypt/lib/database";
import {
  decrypt,
  exportIdentity,
  generateIdentity,
  importIdentity,
  importKey
} from "discourse/plugins/discourse-encrypt/lib/protocol";

/*
 * Possible states of the encryption system.
 */

/**
 * @var {Number} ENCRYPT_DISABLED User does not have any generated keys
 */
export const ENCRYPT_DISABLED = 0;

/**
 * @var {Number} ENCRYPT_ENABLED User has keys, but only on server
 */
export const ENCRYPT_ENABLED = 1;

/**
 * @var {Number} ENCRYPT_ACTIVE User has imported server keys into browser
 */
export const ENCRYPT_ACTIVE = 2;

/**
 * @var {Object} userIdentity Current user's identity.
 */
let userIdentity;

/**
 * @var {Object} userIdentities Cached user identities.
 */
const userIdentities = {};

/**
 * @var {Object} topicKeys Dictionary of all topic keys (topic_id => key).
 */
const topicKeys = {};

/**
 * @var {Object} topicTitles Dictionary of all encrypted topic titles.
 */
const topicTitles = {};

/**
 * Gets current user's identity from the database and caches it for future
 * usage.
 *
 * @return {Promise}
 */
export function getIdentity() {
  if (!userIdentity) {
    userIdentity = loadDbIdentity();
  }

  return userIdentity;
}

export function getUserIdentities(usernames) {
  if (usernames.some(username => !userIdentities[username])) {
    const promise = ajax("/encrypt/user", {
      type: "GET",
      data: { usernames }
    });

    usernames.forEach(username => {
      userIdentities[username] = promise.then(identities =>
        identities[username]
          ? importIdentity(identities[username])
          : Ember.RSVP.Promise.reject(username)
      );
    });
  }

  return Ember.RSVP.Promise.all(
    usernames.map(username => userIdentities[username])
  ).then(identities => {
    const imported = {};
    for (let i = 0; i < usernames.length; ++i) {
      imported[usernames[i]] = identities[i];
    }
    return imported;
  });
}

const debouncedUsernames = new Set();

function _getDebouncedUserIdentities(resolve, reject) {
  getUserIdentities(Array.from(debouncedUsernames))
    .then(identities => {
      Object.keys(identities).forEach(u => debouncedUsernames.delete(u));
      return identities;
    })
    .then(resolve, reject);
}

export function getDebouncedUserIdentities(usernames) {
  usernames.forEach(u => debouncedUsernames.add(u));

  return new Ember.RSVP.Promise((resolve, reject) => {
    debounce(
      debouncedUsernames,
      _getDebouncedUserIdentities,
      resolve,
      reject,
      500
    );
  });
}

/**
 * Puts a topic key into storage.
 *
 * If there is a key in the store already, it will not be overwritten.
 *
 * @param {Number|String} topicId
 * @param {String} key
 */
export function putTopicKey(topicId, key) {
  if (topicId && key) {
    topicKeys[topicId] = key;
  }
}

/**
 * Gets a topic key from storage.
 *
 * @param {Number|String} topicId
 *
 * @return {Promise<CryptoKey>}
 */
export function getTopicKey(topicId) {
  let key = topicKeys[topicId];

  if (!key) {
    return Ember.RSVP.Promise.reject();
  } else if (key instanceof CryptoKey) {
    return Ember.RSVP.Promise.resolve(key);
  } else if (!(key instanceof Promise || key instanceof Ember.RSVP.Promise)) {
    topicKeys[topicId] = getIdentity().then(identity =>
      importKey(key, identity.encryptPrivate)
    );
  }

  return topicKeys[topicId];
}

/**
 * Checks if there is a topic key for a topic.
 *
 * @param {Number|String} topicId
 *
 * @return {Boolean}
 */
export function hasTopicKey(topicId) {
  return !!topicKeys[topicId];
}

/**
 * Puts a topic title into storage.
 *
 * @param {Number|String} topicId
 * @param {String} title
 */
export function putTopicTitle(topicId, title) {
  if (topicId && title) {
    topicTitles[topicId] = title;
  }
}

/**
 * Gets a topic title from storage.
 *
 * @param {Number|String} topicId
 *
 * @return {Promise<String>}
 */
export function getTopicTitle(topicId) {
  let title = topicTitles[topicId];

  if (!title) {
    return Ember.RSVP.Promise.reject();
  } else if (
    !(title instanceof Promise || title instanceof Ember.RSVP.Promise)
  ) {
    topicTitles[topicId] = getTopicKey(topicId)
      .then(key => decrypt(key, title))
      .then(decrypted => decrypted.raw);
  }

  return topicTitles[topicId];
}

/**
 * Checks if there is an encrypted topic title for a topic.
 *
 * @param {Number|String} topicId
 *
 * @return {Boolean}
 */
export function hasTopicTitle(topicId) {
  return !!topicTitles[topicId];
}

/*
 * Plugin management
 */

/**
 * Gets current encryption status.
 *
 * @param {User} user
 *
 * @return {Number} See `ENCRYPT_DISABLED`, `ENCRYPT_ENABLED` and
 *                  `ENCRYPT_ACTIVE`.
 */
export function getEncryptionStatus(user) {
  if (
    !Discourse.SiteSettings.encrypt_enabled ||
    !user ||
    !user.get("custom_fields.encrypt_public")
  ) {
    return ENCRYPT_DISABLED;
  }

  if (
    !window.localStorage.getItem(DB_NAME) ||
    !window.localStorage.getItem(DB_VERSION)
  ) {
    return ENCRYPT_ENABLED;
  }

  return ENCRYPT_ACTIVE;
}

/**
 * Checks if a specific user can enable encryption.
 *
 * This check ensures that:
 *    - user already has encryption enabled OR
 *    - encryption plug-in is enabled AND
 *    - there is no group restriction or user is in one of the allowed groups.
 *
 * @param {User} user
 *
 * @return {Boolean}
 */
export function canEnableEncrypt(user) {
  if (getEncryptionStatus(user) !== ENCRYPT_DISABLED) {
    return true;
  }

  if (Discourse.SiteSettings.encrypt_enabled) {
    if (Discourse.SiteSettings.encrypt_groups.length === 0) {
      return true;
    }

    const encryptGroups = Discourse.SiteSettings.encrypt_groups.split("|");
    const groups = (user.groups || []).map(group => group.name);
    if (groups.some(group => encryptGroups.includes(group))) {
      return true;
    }
  }

  return false;
}

/**
 * Attempts at activating encryption on current device.
 *
 * @param {User} currentUser
 * @param {String} passphrase
 *
 * @return {Promise}
 */
export function activateEncrypt(currentUser, passphrase) {
  const privateKeys = JSON.parse(currentUser.custom_fields.encrypt_private);
  let promise = Ember.RSVP.Promise.reject();

  // Importing from a paper key.
  const spacePos = passphrase.indexOf(" ");
  if (spacePos) {
    const label = "paper_" + passphrase.substr(0, spacePos).toLowerCase();
    if (privateKeys[label]) {
      promise = promise.catch(() =>
        importIdentity(privateKeys[label], passphrase)
      );
    }
  }

  // Importing from a device key.
  if (privateKeys["device"]) {
    promise = promise.catch(() =>
      importIdentity(privateKeys["device"], passphrase)
    );
  }

  // Importing from a passphrase key.
  if (privateKeys["passphrase"]) {
    promise = promise.catch(() =>
      importIdentity(privateKeys["passphrase"], passphrase)
    );
  }

  return promise
    .then(identity => upgradeIdentity(currentUser, passphrase, identity))
    .then(identity => saveDbIdentity(identity));
}

/**
 * Upgrade a user's identity to new version.
 *
 * @param {User} currentUser
 * @param {string} passphrase
 * @param {Object} oldIdentity
 *
 * @return {Object}
 */
function upgradeIdentity(currentUser, passphrase, oldIdentity) {
  // Upgrade identity to version 1 by creating a v1 identity, but replacing
  // encryption keys with old ones.
  if (oldIdentity.version === 0) {
    return generateIdentity(1)
      .then(identity => {
        identity.encryptPublic = oldIdentity.encryptPublic;
        identity.encryptPrivate = oldIdentity.encryptPrivate;
        return identity;
      })
      .then(identity => {
        const savePromise = exportIdentity(identity, passphrase).then(
          exported => {
            const exportedPrivate = JSON.stringify({
              passphrase: exported.private
            });

            currentUser.set("custom_fields.encrypt_public", exported.public);
            currentUser.set("custom_fields.encrypt_private", exportedPrivate);

            return ajax("/encrypt/keys", {
              type: "PUT",
              data: {
                public: exported.public,
                private: exportedPrivate,
                overwrite: true
              }
            });
          }
        );

        return Ember.RSVP.Promise.all([identity, savePromise]).then(
          result => result[0]
        );
      });
  }

  return oldIdentity;
}

export function reload() {
  return window.location.reload();
}

import {
  importKey,
  decrypt
} from "discourse/plugins/discourse-encrypt/lib/keys";
import {
  DB_NAME,
  loadKeyPairFromIndexedDb
} from "discourse/plugins/discourse-encrypt/lib/keys_db";

/**
 * Possible states of the encryption system.
 *
 * @var ENCRYPT_DISABLED User does not have any generated keys
 * @var ENCRYPT_ENABLED User has keys, but only on server
 * @var ENCRYPT_ACTIVE  User has imported server keys into browser
 */
export const ENCRYPT_DISABLED = 0;
export const ENCRYPT_ENABLED = 1;
export const ENCRYPT_ACTIVE = 2;

/**
 * Useful variables for key import and export format.
 */
export const PACKED_KEY_COLUMNS = 71;
export const PACKED_KEY_HEADER =
  "============== BEGIN EXPORTED DISCOURSE ENCRYPT KEY PAIR ==============";
export const PACKED_KEY_SEPARATOR =
  "-----------------------------------------------------------------------";
export const PACKED_KEY_FOOTER =
  "=============== END EXPORTED DISCOURSE ENCRYPT KEY PAIR ===============";

/**
 * @var Array of public and private key.
 */
let rsaKey;

/**
 * @var Dictionary of all topic keys (topic_id => key).
 */
const topicKeys = {};

/**
 * @var Dictionary of all encrypted topic titles.
 */
const topicTitles = {};

/**
 * Gets a user's key pair from the database and caches it for future usage.
 *
 * @return Tuple of public and private `CryptoKey`.
 */
export function getRsaKey() {
  if (!rsaKey) {
    rsaKey = loadKeyPairFromIndexedDb();
  }

  return rsaKey;
}

/**
 * Puts a topic key into storage.
 *
 * If there is a key in the store already, it will not be overwritten.
 *
 * @param topicId
 * @param key
 */
export function putTopicKey(topicId, key) {
  if (topicId && key && !topicKeys[topicId]) {
    topicKeys[topicId] = key;
  }
}

/**
 * Gets a topic key from storage.
 *
 * @param topicId
 *
 * @return Promise
 */
export function getTopicKey(topicId) {
  let key = topicKeys[topicId];

  if (!key) {
    return Ember.RSVP.Promise.reject();
  } else if (key instanceof CryptoKey) {
    return Ember.RSVP.Promise.resolve(key);
  } else if (!(key instanceof Promise || key instanceof Ember.RSVP.Promise)) {
    topicKeys[topicId] = getRsaKey().then(keyPair =>
      importKey(key, keyPair[1])
    );
  }

  return topicKeys[topicId];
}

/**
 * Checks if there is a topic key for a topic.
 *
 * @param topicId
 *
 * @return Boolean
 */
export function hasTopicKey(topicId) {
  return !!topicKeys[topicId];
}

/**
 * Puts a topic title into storage.
 *
 * @param topicId
 * @param key
 */
export function putTopicTitle(topicId, title) {
  if (topicId && title) {
    topicTitles[topicId] = title;
  }
}

/**
 * Gets a topic title from storage.
 *
 * @param topicId
 *
 * @return Promise
 */
export function getTopicTitle(topicId) {
  let title = topicTitles[topicId];

  if (!title) {
    return Ember.RSVP.Promise.reject();
  } else if (
    !(title instanceof Promise || title instanceof Ember.RSVP.Promise)
  ) {
    topicTitles[topicId] = getTopicKey(topicId).then(key =>
      decrypt(key, title)
    );
  }

  return topicTitles[topicId];
}

/**
 * Checks if there is an encrypted topic title for a topic.
 *
 * @param topicId
 *
 * @return Boolean
 */
export function hasTopicTitle(topicId) {
  return !!topicTitles[topicId];
}

/**
 * Gets current encryption status.
 *
 * @param user
 *
 * @return
 */
export function getEncryptionStatus(user) {
  if (
    !Discourse.SiteSettings.encrypt_enabled ||
    !user ||
    !user.get("custom_fields.encrypt_public_key") ||
    !user.get("custom_fields.encrypt_private_key") ||
    !user.get("custom_fields.encrypt_salt")
  ) {
    return ENCRYPT_DISABLED;
  }

  if (!window.localStorage.getItem(DB_NAME)) {
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
 * @param user
 *
 * @return
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
 * Reloads current page.
 *
 * This function is usually called when status change so all initializers
 * checks can run again.
 */
export function reload() {
  window.location.reload();
}

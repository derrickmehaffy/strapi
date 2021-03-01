'use strict';

const { capitalize } = require('lodash/fp');
const { getService } = require('../../utils');

module.exports = async () => {
  // Data
  await ensureDefaultLocale();

  // Sections Builder
  registerSectionsBuilderHandlers();

  // Actions
  registerActions();
  updateActionsProperties();

  // Conditions
  registerConditions();

  // Engine/Permissions
  registerPermissionsHandlers();

  // Hooks & Models
  registerModelsHooks();
};

// Steps

const registerSectionsBuilderHandlers = () => {
  const { sectionsBuilder } = strapi.admin.services.permission;

  // Adding the permissions layout handler for the "locales" property
  sectionsBuilder.addHandler('singleTypes', localesPropertyHandler);
  sectionsBuilder.addHandler('collectionTypes', localesPropertyHandler);
};

const ensureDefaultLocale = async () => {
  const { getDefaultLocale, setDefaultLocale } = getService('locales');

  const defaultLocale = await getDefaultLocale();

  if (!defaultLocale) {
    await setDefaultLocale(DEFAULT_LOCALE);
  }
};

const registerActions = () => {
  const { actionProvider } = strapi.admin.services.permission;

  actionProvider.register(actions);
};

const registerConditions = () => {
  const { conditionProvider } = strapi.admin.services.permission;

  conditionProvider.registerMany(conditions);
};

const updateActionsProperties = () => {
  const { actionProvider } = strapi.admin.services.permission;
  const actions = actionProvider.getAll();

  // Handle already registered actions
  actions.forEach(addLocalesPropertyIfNeeded);

  // Register the transformation for every new action
  actionProvider.addEventListener('actionRegistered', addLocalesPropertyIfNeeded);
};

const registerPermissionsHandlers = () => {
  const { engine } = strapi.admin.services.permission;

  engine.registerPermissionsHandler(i18nPermissionHandler);
};

const registerModelsHooks = () => {
  Object.values(strapi.models)
    .filter(model => getService('content-types').isLocalized(model))
    .forEach(model => {
      strapi.db.lifecycles.register({
        model: model.uid,
        async beforeCreate(data) {
          await getService('localizations').assignDefaultLocale(data);
        },
        async afterCreate(entry) {
          await getService('localizations').addLocalizations(entry, { model });
        },
        async afterUpdate(entry) {
          await getService('localizations').updateNonLocalizedFields(entry, { model });
        },
        async afterDelete(entry) {
          await getService('localizations').removeEntryFromRelatedLocalizations(entry, { model });
        },
      });
    });
};

// Utils

const addLocalesPropertyIfNeeded = action => {
  const {
    section,
    options: { applyToProperties = [] },
  } = action;

  if (section === 'contentTypes' && !applyToProperties.includes('locales')) {
    action.options.applyToProperties = applyToProperties.concat('locales');
  }
};

// Other

const actions = ['create', 'read', 'update', 'delete'].map(uid => ({
  section: 'settings',
  category: 'Internationalization',
  subCategory: 'Locales',
  pluginName: 'i18n',
  displayName: capitalize(uid),
  uid: `locale.${uid}`,
}));

const DEFAULT_LOCALE = {
  code: 'en-US',
};

const conditions = [
  {
    displayName: 'Has Locale Access',
    name: 'has-locale-access',
    plugin: 'i18n',
    handler: (user, options) => {
      const {
        properties: { locales = [] },
      } = options;

      return {
        'locale.code': {
          $in: locales,
        },
      };
    },
  },
];

/**
 * Locales property handler for the permission engine
 * Add the has-locale-access condition if the locales property is defined
 * @param {Permission} permission
 */
const i18nPermissionHandler = permission => {
  const {
    subject,
    properties: { locales = [] },
  } = permission.raw;

  const { isLocalized } = getService('content-types');

  // If there is no subject defined or if the locales property is empty, ignore the permission
  if (!subject || locales.length === 0) {
    return;
  }

  const ct = strapi.contentTypes[subject];

  // If the subject exists but isn't localized, ignore the permission
  if (!isLocalized(ct)) {
    return;
  }

  permission.addCondition('plugins::i18n.has-locale-access');
};

/**
 * Handler for the permissions layout (sections builder)
 * Adds the locales property to the subjects
 * @param action
 * @param section
 * @return {Promise<void>}
 */
const localesPropertyHandler = async (action, section) => {
  const { subjects = [] } = action;

  const locales = await getService('locales').find();

  section.subjects
    // Keep section's subjects included into the action's subjects
    .filter(subject => subjects.includes(subject.uid))
    // Only keep subjects that don't have the locales property yet
    .filter(subject => !subject.properties.find(property => property.value === 'locales'))
    // Add the locale property
    .forEach(subject => {
      subject.properties.push({
        label: 'Locales',
        value: 'locales',
        children: locales.map(({ name, code }) => ({ label: name || code, value: code })),
      });
    });
};

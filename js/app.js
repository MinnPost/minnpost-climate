/**
 * Main application file for: minnpost-climate
 *
 * This pulls in all the parts
 * and creates the main object for the application.
 */
define('minnpost-climate', [
  'underscore', 'jquery', 'Ractive', 'Ractive-events-tap',
  'helpers'
],
  function(_, $, Ractive, R1, helpers) {

  // Constructor for app
  var App = function(options) {
    this.options = _.extend(this.defaultOptions, options);
    this.el = this.options.el;
    if (this.el) {
      this.$el = $(this.el);
    }

    this.getKeys();
  };

  // Extend with helpers
  _.extend(App.prototype, helpers);

  // Extend further
  _.extend(App.prototype, {
    // Starter
    start: function() {

      this.makeRequest('normals/usc00214884').done(function(data, success) {
        if (success && _.isObject(data) && data.success) {

        }
        console.log(data);
      });

    },

    // Determine key
    getKeys: function() {
      // Check for hostname to determine which key to use.  Keys are
      // in the repository as they are out in the open anyway, and
      // HAM Weather checks domains and will stop widget if it
      // comes from a domain that is not registered.
      var keys = {
        clientId: '5R05o9cJLqREMgIU9uVoO',
        clientSecret: 'l0lN3eBsJAuHbYj3Gzaqdwqs0HXIHriyanLDuVKp'
      };
      if (document.location.hostname === 'stage.minnpost.com.228elmp01.blackmesh.com') {
        keys = {
          clientId: '5R05o9cJLqREMgIU9uVoO',
          clientSecret: 'IWdo9yudrvvKgGwzLsioVpdytiU6lLxfY2mjwd3R'
        };
      }
      else if (document.location.hostname === 'localhost') {
        keys = {
          clientId: '5R05o9cJLqREMgIU9uVoO',
          clientSecret: 'mBulBLEwVXDpWRJvbKXOePmhShm9wDQ4hkB9fP4J'
        };
      }

      this.options.keys = keys;
    },

    // Make request
    makeRequest: function(callMethod) {
      var request = 'http://api.aerisapi.com/' + callMethod;
      var append = (callMethod.indexOf('?') !== -1) ? '&' : '?';

      request += append + 'client_id=' + this.options.keys.clientId + '&client_secret=' + this.options.keys.clientSecret + '&callback=?';
      return $.getJSON(request);
    },

    // Default options
    defaultOptions: {
      weatherIconsPath: 'https://s3.amazonaws.com/data.minnpost/icons/ham-weather-icons/'
    }
  });

  return App;
});

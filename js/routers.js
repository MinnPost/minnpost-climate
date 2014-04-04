/**
 * Routers
 */
define('routers', ['jquery', 'underscore', 'Backbone', 'moment'],
  function($, _, Backbone, moment) {
  routers = {};

  // Make class for router
  routers.AppRouter = Backbone.Router.extend({
    routes: {
      'date/:date': 'routeDate',
      '*defaultR': 'routeDefault'
    },

    initialize: function(options) {
      this.app = options.app;
    },

    // Start application, specifically the Backbone mechanims
    start: function() {
      Backbone.history.start();
    },

    // Default route
    routeDefault: function() {
      this.navigate('/date/today', { trigger: true, replace: true });
    },

    // Route for specific date.  Ensure it is a valid date.
    routeDate: function(date) {
      date = (date === 'today') ? moment() : moment(date);

      if (!date.isValid()) {
        this.routeDefault();
        return;
      }

      this.app.refocusView();
      this.app.renderDate(date);
    }
  });

  return routers;
});

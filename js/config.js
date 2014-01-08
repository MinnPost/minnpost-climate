/**
 * RequireJS config which maps out where files are and shims
 * any non-compliant libraries.
 */
require.config({
  shim: {
    'underscore': {
      exports: '_'
    },
    'Backbone': {
      deps: ['underscore', 'jquery'],
      exports: 'Backbone'
    },
    // Mapbox and requireJS don't really work, so we just let
    // the L be global
    'mapbox': {
      exports: 'mapbox'
    }
  },
  baseUrl: 'js',
  paths: {
    'requirejs': '../bower_components/requirejs/require',
    'text': '../bower_components/text/text',
    'jquery': '../bower_components/jquery/jquery.min',
    'underscore': '../bower_components/underscore/underscore-min',
    'Backbone': '../bower_components/backbone/backbone-min',
    'Ractive': '../bower_components/ractive/build/Ractive-legacy.min',
    'Ractive-Backbone': '../bower_components/ractive-backbone/Ractive-Backbone.min',
    'Ractive-events-tap': '../bower_components/ractive-events-tap/Ractive-events-tap.min',
    'minnpost-climate': 'app'
  }
});

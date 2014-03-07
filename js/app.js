/**
 * Main application file for: minnpost-climate
 *
 * This pulls in all the parts
 * and creates the main object for the application.
 */
define('minnpost-climate', [
  'underscore', 'jquery', 'moment',
  'Ractive', 'Ractive-events-tap',
  'helpers',
  'text!templates/loading.mustache',
  'text!templates/application.mustache',
  'text!../data/USW00014922-station.json',
  'text!../data/USW00014922-daily.json'
],
  function(_, $, moment, Ractive, R1, helpers, tLoading, tApp, dataMplsStation, dataMplsDaily) {

  // Read in data
  dataMplsStation = JSON.parse(dataMplsStation);
  dataMplsDaily = JSON.parse(dataMplsDaily);

  // Constructor for app
  var App = function(options) {
    this.options = _.extend(this.defaultOptions, options);
    this.el = this.options.el;
    if (this.el) {
      this.$el = $(this.el);
    }
  };

  // Attach methods
  _.extend(App.prototype, {

    // Starter
    start: function() {
      this.now = moment();
      this.today = moment(this.now.format('YYYY-MM-DD'));
      this.year = this.now.year();

      // We can store all the data in an array of days
      this.days = {};

      // Create view
      this.view = new Ractive({
        el: this.$el,
        template: tApp,
        data: {
        },
        partials: {
          loading: tLoading
        }
      });

      // Parse daily normals
      this.parseNormals(dataMplsDaily);
      // Get recent observations
      this.fetchRecentObservations().done(_.bind(this.createSections, this));
    },

    // Make sections
    createSections: function() {
      var thisApp = this;
      var startWeek = moment(this.today).subtract(7, 'days');
      var startMonth = moment(this.today).subtract(30, 'days');

      // Just today
      this.sectionToday = this.computeSection(
        _.filter(this.days, function(d, di) {
          return d.date.isSame(thisApp.today);
        })
      );

      // Last seven days
      this.sectionWeek = this.computeSection(
          _.sortBy(_.filter(this.days, function(d, di) {
          return d.date.isAfter(startWeek);
        }), function(d, di) { return d.date.unix(); })
      );

      // Last 30 days
      this.sectionMonth = this.computeSection(
          _.sortBy(_.filter(this.days, function(d, di) {
          return d.date.isAfter(startMonth);
        }), function(d, di) { return d.date.unix(); })
      );

      // Attach to view
      this.view.set('sectionToday', this.sectionToday);
      this.view.set('sectionWeek', this.sectionWeek);
      this.view.set('sectionMonth', this.sectionMonth);

      // Mark as computer
      this.view.set('computed', true);
    },

    // Compute comparisons
    computeSection: function(section) {
      section = { days: section };

      // Temp diff
      section.totalTempDiff = _.reduce(section.days, function(total, d, di) {
        return total + (d.temp - d.navg);
      }, 0);
      section.avgTempDiff = section.totalTempDiff / section.days.length;
      // Precip diff
      section.totalPrecipDiff = _.reduce(section.days, function(total, d, di) {
        return total + (d.precip - d.nprecip);
      }, 0);
      section.avgPrecipDiff = section.totalPrecipDiff / section.days.length;

      return section;
    },

    // Parse out normals
    parseNormals: function(data) {
      var thisApp = this;
      var translations = {
        'dly-tmax-normal': 'nmax',
        'dly-tmin-normal': 'nmin',
        'dly-tavg-normal': 'navg',
        'mtd-prcp-normal': 'nprecip',
        'mtd-snow-normal': 'nsnow'
      };

      _.each(translations, function(t, ti) {
        _.each(data[ti], function(d, di) {
          var date = thisApp.dateFromMonthDay(d.m, d.d);
          var id = thisApp.idFromDate(date);

          thisApp.days[id] = thisApp.days[id] || {};
          thisApp.days[id].date = date;
          thisApp.days[id][t] = d.v;
        });
      });
    },

    // Fetch data about recent observations
    fetchRecentObservations: function() {
      var thisApp = this;
      // Currently just use a general amount to ensure we have everything
      // but this could be change to be more accurate
      var recent = this.now.subtract('months', 4);
      var query = "SELECT date, temp, temp_min, temp_max, precip FROM swdata WHERE date > date('" + recent.format('YYYY-MM-DD') + "')";
      var url = this.options.dailyObservationsPath.replace('[[[QUERY]]]', query);

      // Make request
      return $.getJSON(url).done(function(data) {
        _.each(data, function(d, di) {
          var id;
          d.date = moment(d.date);
          id = thisApp.idFromDate(d.date);

          thisApp.days[id] = thisApp.days[id] || {};
          _.extend(thisApp.days[id], d);
        });
      });
    },

    // Create date from month and day dependent on today
    dateFromMonthDay: function(m, d) {
      // We have to determine if the month and day is this
      // year or last
      var date = moment([this.year, m, d]);
      var year = date.isAfter(this.now) ? this.year - 1 : this.year;
      return moment([year, m, d]);
    },

    // Create id from date
    idFromDate: function(date) {
      return date.format('YYYYMMDD');
    },

    // Default options
    defaultOptions: {
      dailyObservationsPath: 'https://premium.scraperwiki.com/bd5okny/ec1140c12061447/sql/?callback=?&q=[[[QUERY]]]'
    }
  });

  return App;
});

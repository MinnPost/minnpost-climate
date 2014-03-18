/**
 * Main application file for: minnpost-climate
 *
 * This pulls in all the parts
 * and creates the main object for the application.
 */
define('minnpost-climate', [
  'underscore', 'jquery', 'moment',
  'Ractive', 'Ractive-events-tap',
  'Highcharts', 'HighchartsMore',
  'helpers',
  'text!templates/loading.mustache',
  'text!templates/chart-tooltip.underscore',
  'text!templates/application.mustache'
],
  function(_, $, moment, Ractive, R1, Highcharts, H1, helpers, tLoading, tTooltip, tApp) {

  // Preprocess some templates
  tTooltip = _.template(tTooltip);

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
      this.yesterday = moment(this.today).subtract(1, 'days');

      // We can store all the data in an array of days
      this.days = {};

      // Create view
      this.view = new Ractive({
        el: this.$el,
        template: tApp,
        data: {
          options: this.options,
          helpers: helpers
        },
        partials: {
          loading: tLoading
        }
      });

      // Respond to view events
      this.view.observe('computed', function(n, o) {
        this.drawCharts();
      }, { init: false, defer: true, context: this });

      // Get recent observations
      this.fetchRecentObservations().done(_.bind(this.dataLoaded, this));
    },

    // Data loaded.  We need to know what the max day is that we
    // have before making other decisions
    dataLoaded: function(data) {
      // Determine if we have today's or yesterday's data yet
      var max = _.max(data, function(d, di) {
        return moment(d.date, 'YYYY-MM-DD').unix();
      });
      if (this.today.isSame(max.date)) {
        this.isYesterday = false;
      }
      else if (this.yesterday.isSame(max.date)) {
        this.isYesterday = true;
        this.today = max.date;
      }
      this.year = this.today.year();

      // Set some data for views
      this.view.set('isYesterday', this.isYesterday);

      // Determine season
      this.determineSeason();

      // Create sections for interface
      this.createSections();
    },

    // Draw charts
    drawCharts: function() {
      this.$el.find('.chart-section-week').highcharts(this.makeChartOptions(this.sectionWeek));
      this.$el.find('.chart-section-month').highcharts(this.makeChartOptions(this.sectionMonth));
      this.$el.find('.chart-section-season').highcharts(this.makeChartOptions(this.sectionSeason));
    },

    // Make chart options for specific section
    makeChartOptions: function(section) {
      var options = _.clone(this.options.chartOptions);

      return _.extend({}, options, {
        tooltip: {
          shadow: false,
          borderWidth: 0.5,
          style: {},
          useHTML: true,
          formatter: function() {
            return tTooltip({ data: this });
          }
        },
        series: [
          {
            name: 'Difference of average temperature from normal',
            type: 'column',
            color: '#1D71A5',
            zIndex: 100,
            data: _.map(section.days, function(d, di) {
              return _.extend({
                x: Date.UTC(d.date.year(), d.date.month(), d.date.date()),
                y: Math.round(d.tempDiff * 10) / 10,
                color: (d.tempDiff >= 0) ? '#DB423D' : '#15829E'
              }, d);
            })
          }
        ]
      });
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

      // Season
      this.sectionSeason = this.computeSection(
          _.sortBy(_.filter(this.days, function(d, di) {
          return ((d.date.isAfter(thisApp.options.seasons[thisApp.season].start) ||
            d.date.isSame(thisApp.options.seasons[thisApp.season].start)) &&
            d.date.isBefore(thisApp.options.seasons[thisApp.season].end));
        }), function(d, di) { return d.date.unix(); })
      );

      // Attach to view
      this.view.set('sectionToday', this.sectionToday);
      this.view.set('sectionWeek', this.sectionWeek);
      this.view.set('sectionMonth', this.sectionMonth);
      this.view.set('sectionSeason', this.sectionSeason);

      // Mark as computer
      this.view.set('computed', true);
    },

    // Compute comparisons
    computeSection: function(section) {
      section = { days: section };

      // Temp diff
      section.days = _.map(section.days, function(d, di) {
        d.tempDiff = d.tavg - d.ntavg;
        return d;
      });
      section.totalTempDiff = _.reduce(section.days, function(total, d, di) {
        return total + (d.tavg - d.ntavg);
      }, 0);
      section.avgTempDiff = section.totalTempDiff / section.days.length;

      // Precip diff
      /*
      section.totalPrecipDiff = _.reduce(section.days, function(total, d, di) {
        return total + (d.precip - d.nprecip);
      }, 0);
      section.avgPrecipDiff = section.totalPrecipDiff / section.days.length;
      */

      return section;
    },

    // Fetch data about recent observations
    fetchRecentObservations: function() {
      var thisApp = this;
      // Currently just use a general amount to ensure we have everything
      // but this could be change to be more accurate
      var recent = this.now.subtract('months', 5);
      var query = [];

      query.push("SELECT");
      query.push("  o.date, o.tmax, o.tmin,");
      query.push("  n.ntmax, n.ntmin, n.ntavg,");
      query.push("    CASE WHEN tavg IS NULL THEN ROUND((o.tmax + o.tmin) / 2, 2)");
      query.push("      ELSE tavg END AS tavg");
      query.push("FROM observations AS o");
      query.push("  INNER JOIN normals AS n ON");
      query.push("    o.month = n.month AND o.day = n.day");
      query.push("WHERE o.date > DATE('" + recent.format('YYYY-MM-DD') + "')");
      var url = this.options.dailyObservationsPath.replace('[[[QUERY]]]', encodeURIComponent(query.join(' ')));

      // Make request
      return $.getJSON(url).done(function(data) {
        // Add data to days collection.
        _.each(data, function(d, di) {
          var id;
          d.date = moment(d.date, 'YYYY-MM-DD');
          id = thisApp.idFromDate(d.date);

          thisApp.days[id] = thisApp.days[id] || {};
          _.extend(thisApp.days[id], d);
        });
      });
    },

    // Determine what season we are in
    determineSeason: function() {
      var thisApp = this;

      // Adjust the season years
      // TODO

      // Look to see what today is in.
      _.each(this.options.seasons, function(s, si) {
        if ((thisApp.today.isAfter(s.start) ||
          thisApp.today.isSame(s.start)) &&
          thisApp.today.isBefore(s.end)) {
          thisApp.season = si;
        }
      });

      // Attach other parts to view
      this.view.set('season', this.season);
      this.view.set('seasonSpan', this.options.seasons[this.season]);
    },

    // Make chart data from collection
    chartData: function(collection, properties) {
      properties = _.isArray(properties) ? properties : [ properties ];

      return _.values(_.map(collection, function(c, ci) {
        // The way highcharts accepts dates is weird
        var date = Date.UTC(c.date.year(), c.date.month(), c.date.date());
        var set = [ date ];

        _.each(properties, function(p, pi) {
          set.push(c[p]);
        });
        return set;
      }));
    },

    // Create date from month and day dependent on today
    dateFromMonthDay: function(m, d) {
      // We have to determine if the month and day is this
      // year or last
      var date = moment([this.year, m - 1, d]);
      var year = date.isAfter(this.today) ? this.year - 1 : this.year;
      return moment([year, m - 1, d]);
    },

    // Create id from date
    idFromDate: function(date) {
      return date.format('YYYYMMDD');
    },

    // Default options
    defaultOptions: {
      dailyObservationsPath: 'https://premium.scraperwiki.com/d7fssyq/a43576483d6f43a/sql/?callback=?&q=[[[QUERY]]]',
      seasons: {
        // Start is inclusive
        winter: {
          start: moment('2013-12-01', 'YYYY-MM-DD'),
          end: moment('2014-04-01', 'YYYY-MM-DD')
        },
        spring: {
          start: moment('2014-04-01', 'YYYY-MM-DD'),
          end: moment('2014-06-21', 'YYYY-MM-DD')
        },
        summer: {
          start: moment('2014-06-21', 'YYYY-MM-DD'),
          end: moment('2014-09-21', 'YYYY-MM-DD')
        },
        fall: {
          start: moment('2014-09-21', 'YYYY-MM-DD'),
          end: moment('2014-12-1', 'YYYY-MM-DD')
        }
      },
      chartOptions: {
        chart: {
          style: {
            fontFamily: '"HelveticaNeue-Light", "Helvetica Neue Light", "Helvetica Neue", Helvetica, Arial, "Lucida Grande", sans-serif',
            color: '#BCBCBC'
          },
          spacingRight: 15
        },
        colors: ['#1D71A5', '#1DA595', '#1DA551'],
        credits: {
          enabled: false
        },
        title: {
          enabled: false,
          text: null
        },
        legend: {
          enabled: false,
          borderWidth: 0
        },
        plotOptions: {
          line: {
            lineWidth: 3,
            states: {
              hover: {
                lineWidth: 3
              }
            },
            marker: {
              enabled: false
            }
          },
          column: {
            minPointLength: 2,
            groupPadding: 0.05,
            pointPadding: 0.0
          }
        },
        xAxis: {
          type: 'datetime',
          startOnTick: false,
          dateTimeLabelFormats: {
            hour: ' ',
            day: '%b %e',
            week: '%b %e',
            month: '%b %e',
            year: '%b'
          }
        },
        yAxis: {
          title: {
            enabled: true,
            useHTML: true,
            text: '&deg;F',
            margin: 5,
            style: {
              color: 'inherit',
              fontWeight: 'normal'
            }
          },
          gridLineColor: '#BCBCBC'
        },
        tooltip: {
          //shadow: false,
          //borderRadius: 0,
          //borderWidth: 0,
          shared: true,
          style: {},
          useHTML: true,
          valueSuffix: '&deg;F'
          //formatter: function() {
          //  return '<strong>' + this.key + '</strong> <br /> <br /> ' + this.//series.name + ': <strong>' + this.y + '</strong>';
          //}
        }
      }
    }
  });

  return App;
});

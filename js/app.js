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
  'text!templates/application.mustache',
  'text!../data/USW00014922-station.json',
  'text!../data/USW00014922-daily.json'
],
  function(_, $, moment, Ractive, R1, Highcharts, H1, helpers, tLoading, tApp, dataMplsStation, dataMplsDaily) {

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
      this.yesterday = moment(this.today).subtract(1, 'days');
      this.year = this.now.year();

      // Determine season
      this.determineSeason();

      // We can store all the data in an array of days
      this.days = {};

      // Create view
      this.view = new Ractive({
        el: this.$el,
        template: tApp,
        data: {
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

      // Parse daily normals
      this.parseNormals(dataMplsDaily);
      // Get recent observations
      this.fetchRecentObservations().done(_.bind(this.createSections, this));
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
        series: [
          {
            name: 'Observed temp',
            type: 'line',
            color: '#1D71A5',
            zIndex: 100,
            data: this.chartData(section.days, 'temp')
          },
          {
            name: 'Observed high and low',
            color: '#1D71A5',
            type: 'arearange',
            fillOpacity: 0.3,
            zIndex: 10,
            lineWidth: 0,
            data: this.chartData(section.days, ['temp_min', 'temp_max'])
          },
          {
            name: 'Average temp',
            type: 'line',
            color: '#1DA595',
            zIndex: 50,
            lineWidth: 4,
            data: this.chartData(section.days, 'navg')
          },
          {
            name: 'Average high and low',
            color: '#1DA595',
            type: 'arearange',
            fillOpacity: 0.15,
            zIndex: 0,
            lineWidth: 0,
            data: this.chartData(section.days, ['nmin', 'nmax'])
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

      // Attach other parts to view
      this.view.set('season', this.season);
      this.view.set('seasonSpan', this.options.seasons[this.season]);
      this.view.set('options', this.options);

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

    // Determine whether the data reflects today, or not
    adjustToday: function(today) {
      if (this.today.isSame(today)) {
        this.isYesterday = false;
      }
      else if (this.yesterday.isSame(today)) {
        this.isYesterday = true;
        this.today = today;
      }
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
        // Determine if we have today's or yesterday's data yet
        var max = _.max(data, function(d, di) {
          return moment(d.date, 'YYYY-MM-DD').unix();
        });
        thisApp.adjustToday(max);

        // Add data to days collection
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
      var year = date.isAfter(this.now) ? this.year - 1 : this.year;
      return moment([year, m - 1, d]);
    },

    // Create id from date
    idFromDate: function(date) {
      return date.format('YYYYMMDD');
    },

    // Default options
    defaultOptions: {
      dailyObservationsPath: 'https://premium.scraperwiki.com/bd5okny/ec1140c12061447/sql/?callback=?&q=[[[QUERY]]]',
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
          }
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
          }
        },
        xAxis: {
          type: 'datetime',
          dateTimeLabelFormats: {
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

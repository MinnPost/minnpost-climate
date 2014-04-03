

/**
 * Helpers to extend to an app.
 */
define('helpers', ['jquery', 'underscore'],
  function($, _) {

  return {
    
    /**
     * Word case.
     */
    wordCase: function(str) {
      return str.replace(/\w\S*/g, function(txt) {
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
      });
    },

    /**
     * Formats number
     */
    formatNumber: function(num, decimals) {
      decimals = (_.isUndefined(decimals)) ? 2 : decimals;
      var rgx = (/(\d+)(\d{3})/);
      split = num.toFixed(decimals).toString().split('.');

      while (rgx.test(split[0])) {
        split[0] = split[0].replace(rgx, '$1' + ',' + '$2');
      }
      return (decimals) ? split[0] + '.' + split[1] : split[0];
    },

    /**
     * Formats number into currency
     */
    formatCurrency: function(num) {
      return '$' + this.formatNumber(num, 2);
    },

    /**
     * Formats percentage
     */
    formatPercent: function(num) {
      return this.formatNumber(num * 100, 1) + '%';
    },

    /**
     * Formats percent change
     */
    formatPercentChange: function(num) {
      return ((num > 0) ? '+' : '') + this.formatPercent(num);
    },

    /**
     * Converts string into a hash (very basically).
     */
    hash: function(str) {
      return Math.abs(_.reduce(str.split(''), function(a, b) {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
      }, 0));
    },

    /**
     * Returns version of MSIE.
     */
    isMSIE: function() {
      var match = /(msie) ([\w.]+)/i.exec(navigator.userAgent);
      return match ? parseInt(match[2], 10) : false;
    },


    /**
     * Override Backbone's ajax call to use JSONP by default as well
     * as force a specific callback to ensure that server side
     * caching is effective.
     */
    BackboneAJAX: function() {
      var options = arguments;

      if (options[0].dataTypeForce !== true) {
        options[0].dataType = 'jsonp';
        options[0].jsonpCallback = 'mpServerSideCachingHelper' +
          _.hash(options[0].url);
      }
      return Backbone.$.ajax.apply(Backbone.$, options);
    },


    /**
     * Wrapper for a JSONP request
     */
    jsonpRequest: function() {
      var options = arguments[0];

      options.dataType = 'jsonp';
      options.jsonpCallback = 'mpServerSideCachingHelper' +
        _.hash(options.url);
      return $.ajax.apply($, [options]);
    },

    /**
     * Data source handling.  For development, we can call
     * the data directly from the JSON file, but for production
     * we want to proxy for JSONP.
     *
     * `name` should be relative path to dataset minus the .json
     *
     * Returns jQuery's defferred object.
     */
    getLocalData: function(name) {
      var thisApp = this;
      var proxyPrefix = this.options.jsonpProxy;
      var useJSONP = false;
      var defers = [];

      this.data = this.data || {};
      name = (_.isArray(name)) ? name : [ name ];

      // If the data path is not relative, then use JSONP
      if (this.options && this.options.dataPath.indexOf('http') === 0) {
        useJSONP = true;
      }

      // Go through each file and add to defers
      _.each(name, function(d) {
        var defer;
        if (_.isUndefined(thisApp.data[d])) {

          if (useJSONP) {
            defer = this.jsonpRequest({
              url: proxyPrefix + encodeURI(thisApp.options.dataPath + d + '.json')
            });
          }
          else {
            defer = $.getJSON(thisApp.options.dataPath + d + '.json');
          }

          $.when(defer).done(function(data) {
            thisApp.data[d] = data;
          });
          defers.push(defer);
        }
      });

      return $.when.apply($, defers);
    },

    /**
     * Get remote data.  Provides a wrapper around
     * getting a remote data source, to use a proxy
     * if needed, such as using a cache.
     */
    getRemoteData: function(options) {
      options.dataType = 'jsonp';

      if (this.options.remoteProxy) {
        options.url = options.url + '&callback=proxied_jqjsp';
        options.url = app.options.remoteProxy + encodeURIComponent(options.url);
        options.callback = 'proxied_jqjsp';
        options.cache = true;
      }

      return $.ajax(options);
    }
  };
});

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
      date = (date.isValid()) ? date : moment();
      this.app.renderDate(date);
    }
  });

  return routers;
});

define('text!templates/loading.mustache',[],function () { return '<div class="loading-container">\n  <div class="loading"><span>Loading...</span></div>\n</div>';});

define('text!templates/chart-tooltip.underscore',[],function () { return '<div class="chart-tooltip">\n  <strong><%= Highcharts.dateFormat(\'%A, %b. %e, %Y\', data.key) %></strong><br/>\n  <%= data.series.name %>: <%= Math.round(data.y * 10) / 10 %>&deg;F <br />\n  <br />\n  Average temperature: <%= Math.round(data.point.tavg * 10) / 10 %>&deg;F <br />\n  High and low temperature: <%= Math.round(data.point.tmax * 10) / 10 %> - <%= Math.round(data.point.tmin * 10) / 10 %>&deg;F<br />\n  <br />\n  Normal avg. temperature: <%= Math.round(data.point.ntavg * 10) / 10 %>&deg;F <br />\n  Normal avg. high and low: <%= Math.round(data.point.ntmax * 10) / 10 %> - <%= Math.round(data.point.ntmin * 10) / 10 %>&deg;F<br />\n</div>\n';});

define('text!templates/application.mustache',[],function () { return '<div class="message-container"></div>\n\n<div class="content-container">\n\n  {{^computed}}\n    {{>loading}}\n  {{/computed}}\n\n  {{#computed}}\n\n    {{^isToday}}\n      <div class="not-today">\n        Showing weather trends from <strong>{{ date.format(\'dddd, MMM. Do, YYYY\') }}</strong>.\n      </div>\n    {{/isToday}}\n\n    <div class="section-section">\n      <h3>Today</h3>\n      <p>\n        {{#isToday}} Today\'s average temperature so far is {{/isToday}}\n        {{^isToday}} Today\'s average temperature was {{/isToday}}\n        about\n        <strong>\n          {{ Math.abs(Math.round(sectionToday.avgTempDiff * 10) / 10) }}&deg;F\n          {{#(sectionToday.avgTempDiff > 0)}} warmer {{/()}}\n          {{#(sectionToday.avgTempDiff < 0)}} colder {{/()}}\n        </strong>\n        than the normal temperature for this date ({{ sectionToday.days.0.ntavg }}&deg;F).\n      </p>\n    </div>\n\n\n    <div class="section-section">\n      <h3>Last week</h3>\n\n      <p>\n        This past week (7 days) was, on average, about\n        <strong>\n          {{ Math.abs(Math.round(sectionWeek.avgTempDiff * 10) / 10) }}&deg;F\n          {{#(sectionWeek.avgTempDiff > 0)}} warmer {{/()}}\n          {{#(sectionWeek.avgTempDiff < 0)}} colder {{/()}}\n        </strong>\n        each day than the normal average daily temperature.\n      </p>\n\n      <div class="chart chart-section-week"></div>\n    </div>\n\n\n    <div class="section-section">\n      <h3>Last 30 days</h3>\n\n      <p>\n        The past month (30 days) was, on average, about\n        <strong>\n          {{ Math.abs(Math.round(sectionMonth.avgTempDiff * 10) / 10) }}&deg;F\n          {{#(sectionMonth.avgTempDiff > 0)}} warmer {{/()}}\n          {{#(sectionMonth.avgTempDiff < 0)}} colder {{/()}}\n        </strong>\n        each day than the normal average temperature.\n      </p>\n\n      <div class="chart chart-section-month"></div>\n    </div>\n\n\n    <div class="section-section">\n      <h3>This {{ season }}</h3>\n\n      <p>\n        This {{ season }}\n        ({{ seasonSpan.start.format(\'MMM. Do\') }} - {{ seasonSpan.end.subtract(1, \'days\').format(\'MMM. DD\') }})\n        has been, on average, about\n        <strong>\n          {{ Math.abs(Math.round(sectionSeason.avgTempDiff * 10) / 10) }}&deg;F\n          {{#(sectionSeason.avgTempDiff > 0)}} warmer {{/()}}\n          {{#(sectionSeason.avgTempDiff < 0)}} colder {{/()}}\n        </strong>\n        each day than the normal average temperature.\n      </p>\n\n      <div class="chart chart-section-season"></div>\n    </div>\n\n  {{/computed}}\n\n</div>\n\n<div class="footnote-container">\n  <div class="footnote">\n    <p><a href="http://www.ncdc.noaa.gov/oa/climate/normals/usnormals.html" target="_blank">Climate normals</a>, the baseline for comparison, are the latest three-decade (1981-2010) averages of climatological variables and are provided by the National Oceanic and Atmospheric Administration (NOAA).</p>\n\n    <p>Observation data for Minneapolis/St. Paul International Airport and data prior to 1938 is for downtown Minneapolis.  Data collected from\n      <a href="http://www.ncdc.noaa.gov/cgi-bin/res40.pl?page=gsod.html" target="_blank">NOAA National Climatic Data Center (NCDC) Global Surface Summary of Day (GSOD)</a>, <a href="http://www.ncdc.noaa.gov/oa/climate/ghcn-daily/" target="_blank">NOAA NCDC Global Historical Climatology Network (GHCN)</a>, <a href="http://climate.umn.edu/doc/twin_cities/twin_cities.htm" target="_blank">Minnesota Climatology Office Historical Climate Data Listings for the Twin Cities</a>, <a href="http://www.nws.noaa.gov/climate/f6.php?wfo=mpx" target="_blank">NOAA National Weather Service (NWS) Preliminary Monthly Climate Data</a>, and <a href="http://w1.weather.gov/xml/current_obs/seek.php" target="_blank">NOAA NWS Feeds of Current Weather Conditions</a>.</p>\n\n    <p>Some code, techniques, and data on <a href="https://github.com/minnpost/minnpost-climate" target="_blank">Github</a>. Calendar icon designed by Marcio Duarte from <a href="http://thenounproject.com/term/calendar/7134/" target="_blank">the Noun Project</a>.</p>\n\n  </div>\n</div>\n';});

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
  'helpers', 'routers',
  'text!templates/loading.mustache',
  'text!templates/chart-tooltip.underscore',
  'text!templates/application.mustache'
],
  function(_, $, moment, Ractive, R1, Highcharts, H1, helpers, routers, tLoading, tTooltip, tApp) {
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
      // Make dates.  The date property is the date we are looking at
      this.now = moment();
      this.today = moment(this.now.format('YYYY-MM-DD'));
      this.yesterday = moment(this.today).subtract(1, 'days');
      this.date = moment(this.today);

      // We can store all the data in an array of days
      this.days = {};

      // Create router
      this.router = new routers.AppRouter({ app: this });
      this.router.start();
    },

    // Show specific date
    renderDate: function(date) {
      this.date = date;
      this.isToday = (date.isSame(this.today, 'day'));

      // Reset some things
      if (_.isObject(this.view)) {
        this.view.teardown();
        this.days = {};
      }

      // Create view
      this.view = new Ractive({
        el: this.$el,
        template: tApp,
        data: {
          isToday: this.isToday,
          date: date,
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
      this.fetchRecentObservations(date).done(_.bind(this.dataLoaded, this));
    },

    // Handle general error
    handleError: function(message) {
      this.router.routeDefault();
    },

    // Data loaded.  We need to know what the max day is that we
    // have before making other decisions
    dataLoaded: function(data) {
      if (!_.isArray(data) || data.length < 30) {
        this.handleError('Not enough data found.');
        return;
      }

      // Determine if we have today's or yesterday's data yet
      var max = _.max(data, function(d, di) {
        return moment(d.date, 'YYYY-MM-DD').unix();
      });
      if (!this.date.isSame(max.date)) {
        this.date = moment(max.date);
      }
      this.year = this.date.year();

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
      var startWeek = moment(this.date).subtract(7, 'days');
      var startMonth = moment(this.date).subtract(30, 'days');

      // Just today
      this.sectionToday = this.computeSection(
        _.filter(this.days, function(d, di) {
          return d.date.isSame(thisApp.date);
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

      // Mark as computed
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
    fetchRecentObservations: function(date) {
      var thisApp = this;
      // Currently just use a general amount to ensure we have everything
      // but this could be change to be more accurate
      var recent = moment(this.date).subtract('months', 5);
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
      query.push("  AND o.date <= DATE('" + this.date.format('YYYY-MM-DD') + "')");
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

    // Determine what season we are in.  This gets a bit messy when
    // adjusting for the year
    determineSeason: function() {
      var thisApp = this;
      var year = this.date.year();

      // Look to see what today is in.
      _.each(this.options.seasons, function(s, si) {
        s.start.year(year);
        s.end.year(year);

        // But if winter ...
        if (si === 'winter') {
          if (thisApp.date.month() < 6) {
            s.start.year(year - 1);
          }
          else {
            s.end.year(year + 1);
          }
        }

        // Check if within season range
        if ((thisApp.date.isAfter(s.start) ||
          thisApp.date.isSame(s.start)) &&
          thisApp.date.isBefore(s.end)) {
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
      var year = date.isAfter(this.date) ? this.year - 1 : this.year;
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

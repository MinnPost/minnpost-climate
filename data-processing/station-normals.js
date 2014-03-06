/**
 * Process station normals into JSON files.
 *
 * Explains formats:
 * http://www1.ncdc.noaa.gov/pub/data/normals/1981-2010/readme.txt
 *
 * Example:
 * http://www1.ncdc.noaa.gov/pub/data/normals/1981-2010/products/station/USW00014922.normals.txt
 */

var fs = require('fs');
var path = require('path');
var request = require('request');
var _ = require('lodash');

// Top level variables
var stations = [
  'USW00014922' // Minneapolis
];
var normalsURL = 'http://www1.ncdc.noaa.gov/pub/data/normals/1981-2010/products/station/[[[STATION]]].normals.txt';
var prettyJSON = false;
var dataPath = path.join(__dirname, '../data/');

// Go through stations
stations.forEach(function(s, si) {
  getStation(s);
});

// Get station
function getStation(id) {
  var url = normalsURL.replace('[[[STATION]]]', id);

  // Download data
  request(url, function(error, response, body) {
    if (!error && response.statusCode == 200) {
      body = body.split('\n');

      processStation(body, id);
      processDaily(body, id);
    }
    else {
      console.error('Error with fetching station: ' + id);
    }
  })
}

// Get station data
function processStation(lines, station) {
  var stationData = {};
  stationData.name = lines[0].split(':')[1].trim();
  stationData.ghcnDailyID = lines[1].split(':')[1].trim();
  stationData.lat = parseFloat(lines[2].split(':')[1].trim());
  stationData.lon = parseFloat(lines[3].split(':')[1].trim());
  stationData.elevation = parseFloat(lines[4].split(':')[1].trim());

  writeJSON(stationData, station + '-station.json');
}

// Get yearly data
function processYearly(lines, station) {

}

// Get monthly data
function processMonthly(lines, station) {

}

// Get daily
function processDaily(lines, station) {
  var tempSections = ['dly-tmax-normal', 'dly-tmin-normal', 'dly-tavg-normal', 'dly-dutr-normal'];
  var precipSections = ['mtd-prcp-normal'];
  var snowSections = ['mtd-snow-normal'];
  var daily = {};

  tempSections.forEach(function(s, si) {
    daily[s] = readDailySection(s, lines, 'temp');
  });
  precipSections.forEach(function(s, si) {
    daily[s] = readDailySection(s, lines, 'precip');
  });
  snowSections.forEach(function(s, si) {
    daily[s] = readDailySection(s, lines, 'snow');
  });

  writeJSON(daily, station + '-daily.json');
}

// Read specific daily section
function readDailySection(section, lines, type) {
  var start = _.findIndex(lines, function(l, li) {
    return (l.indexOf(section) === 0);
  });
  var sectionLines = lines.slice(start, start + 12);
  var data = [];

  // Go through each row
  sectionLines.forEach(function(l, li) {
    var parsed = readDailyLine(l);
    var firstMonth;
    var units = 10;

    // Remove leap day as it gets weird
    if (li === 1) {
      parsed = parsed.slice(0, 28);
    }

    // Temperature is in format 234S which is 23.5F
    if (type === 'temp') {
      parsed.forEach(function(p, pi) {
        data.push({
          m: li + 1,
          d: pi + 1,
          v: (p / 10)
        });
      });
    }
    // Precipitation is actually month to date total,
    // like 63C which 6.3 in, so we have to subtract
    // from the one before it.
    else if (type === 'precip' || type === 'snow') {
      units = (type === 'precip') ? 100 : 10;
      parsed.forEach(function(p, pi) {
        data.push({
          m: li + 1,
          d: pi + 1,
          v: (pi === null) ? null :
            (pi === 0) ? (p / units) : ((p - parsed[pi - 1]) / units)
        });
      });
    }
  });

  return data;
}

// Read daily line
function readDailyLine(line) {
  var firstValue = 20;
  var increment = 7;
  var parsed = [];
  var i, value;

  for (i = firstValue; i < line.length; i = i + increment) {
    value = line.slice(i, i + increment);
    value = value.trim();
    value = (value === '-7777') ? '0' : value;
    value = value.replace(/[A-Z]/g, '');
    // Because the way operations with floats in JS works,
    // we keep the integer value, then output as decimal
    value = parseInt(value);

    // Normal value
    if (value > -1000) {
      parsed.push(value);
    }
    else if (value === -9999) {
      parsed.push(null);
    }
  }

  return parsed;
}

// Write out file
function writeJSON(data, filename) {
  var content = (prettyJSON) ? JSON.stringify(data, null, 2) :
    JSON.stringify(data);
  filename = path.join(dataPath, filename);

  fs.writeFile(filename, content, function(error) {
    if (error) {
      console.error('Error writing file: ' + filename);
    }
    else {
      console.log('Data saved to: ' + filename);
    }
  });
}

#!/usr/bin/env python

# Meant for ScraperWiki

# Scrapes NOAA data to get observation and normals data for specific stations
#
# Unfortunately this is put together with multiple different datasets:
#
# For historical observations, use NOAA NCDC Global Historical
# Climate Network (GHCN)
# ftp://ftp.ncdc.noaa.gov/pub/data/ghcn/daily/readme.txt
# ftp://ftp.ncdc.noaa.gov/pub/data/ghcn/daily/all/USW00014922.dly
#
# For Normals use NOAA NCDC Normals
# http://www1.ncdc.noaa.gov/pub/data/normals/1981-2010/readme.txt
#
# The GHCN data is missing the most recent two weeks (about), so
# this is supplemented with NOAA Global Surface Summary Data (GSOD)
# ftp://ftp.ncdc.noaa.gov/pub/data/gsod/readme.txt
# ftp://ftp.ncdc.noaa.gov/pub/data/gsod/2014/726580-14922-2014.op.gz
#
# For Twin Cities historical climate data we use the State Climatology Office
# which is through the U of M:
# http://climate.umn.edu/
# Twin Cities data sources:
# http://climate.umn.edu/doc/twin_cities/twin_cities.htm
#
# The finally for the most recent day, use ????

import scraperwiki
import gzip
import urllib2
import StringIO
import dateutil.parser
import json
from BeautifulSoup import BeautifulSoup
from datetime import datetime, date, timedelta
from dateutil.relativedelta import relativedelta


class DailyWeatherScraper:

  # Stations
  stations = [
    # MSP Airport, GHCN ID, GSOD ID
    ('USW00014922', '726580-14922', 'KMSP', 'MPX', 'MSP')
  ]

  # URL templates
  ghcn_url_template = 'ftp://ftp.ncdc.noaa.gov/pub/data/ghcn/daily/all/%(ghcn_station)s.dly'
  normals_url_template = 'http://www1.ncdc.noaa.gov/pub/data/normals/1981-2010/products/station/%(ghcn_station)s.normals.txt'
  gsod_url_template = 'ftp://ftp.ncdc.noaa.gov/pub/data/gsod/%(year)s/%(gsod_station)s-%(year)s.op.gz'
  mn_url_template = 'http://climate.umn.edu/doc/twin_cities/msp%(mn_decade)s\'s.htm'
  mn_decades = range(1870, 2010, 10)
  nws_monthly_url_template = 'http://www.nws.noaa.gov/climate/getclimate.php?date=&wfo=%(wfo_id)s&sid=%(sid_id)s&pil=CF6&recent=&specdate=%(end_month_date)s+11:11:11'

  # Measurements to keep
  ghcn_measurements = ['tmax', 'tmin', 'prcp', 'snow', 'snwd']
  normals_measurements = [
    # Section keyword, db field to save to, how to process value
    ('dly-tmax-normal', 'ntmax', 'temp'),
    ('dly-tmin-normal', 'ntmin', 'temp'),
    ('dly-tavg-normal', 'ntavg', 'temp'),
    ('mtd-prcp-normal', 'nprcp', 'precip'),
    ('mtd-snow-normal', 'nsnow', 'snow')
  ]


  # Constructor
  def __init__(self):
    self.isRecent = False
    self.year = date.today().year
    self.date = date.today()
    self.recent = date.today() - timedelta(days = 30)
    self.recent_year = self.recent.year



  # Parse out a number
  def parse_num(self, x):
    found = None
    try:
      found = int(x)
    except ValueError:
      try:
        found = float(x)
      except ValueError:
        return None

    return found

  # Check if number
  def is_number(self, x):
    x = self.parse_num(x)
    return isinstance(x, (int, long, float, complex))

  # Read in a value and parse a number
  def read_number_value(self, value, none_amount = [999999]):
    value = self.parse_num(value.strip())
    # These values mean no data
    if value in none_amount:
      return None
    return value

  # Checks for a flag value which is binary
  def read_binary_value(self, value, valids = ['*', '1']):
    if value.strip() in valids:
      return True
    return False

  # Convert celsius to fahrenheit
  def to_fahrenheit(self, c):
    return (c * 1.8) + 32

  # Convert mm to inches
  def to_inches_from_mm(self, mm):
    return mm / 25.4

  # Get last day of month of a date
  def last_day_of_month(self, d):
    # Add month and subtract a day from the first of the month
    d = date(d.year, d.month, 1)
    return d + relativedelta(months = 1) - timedelta(days = 1)



  # Open remote file, return file
  # See: http://stackoverflow.com/questions/16241469/decompress-remote-gz-file-in-python
  def open_remote_file(self, url):
    response = urllib2.urlopen(url)

    if '.gz' in url:
      compressedFile = StringIO.StringIO()
      compressedFile.write(response.read())
      compressedFile.seek(0)
      decompressedFile = gzip.GzipFile(fileobj = compressedFile, mode = 'rb')
      return decompressedFile
    else:
      return response

  # Read url
  def read_url(self, url, readlines = True):
    try:
      file = self.open_remote_file(url)
      data = file.readlines() if readlines else file
      return data
    except urllib2.URLError:
      print "Could not find file for station %s: %s." % (self.station, url)
    except Exception as ex:
      template = "An exception of type {0} occured. Arguments: \n {1!r}"
      message = template.format(type(ex).__name__, ex.args)
      print message




  # Update data in a way that is not destructive
  def update_data(self, data, keys, table = 'swdata', doNotOverwriteGHCN = False):
    tables = scraperwiki.sqlite.show_tables()

    # Make find query
    query = "* FROM %s WHERE " % table
    where = []
    for k in keys:
      if self.is_number(data[k]):
        where.append(k + "=%s " % data[k])
      else:
        where.append(k + "='%s' " % data[k])
    query = query + " AND ".join(where)

    # Save.  We have to get the current data so that it does not
    # overwrite things
    if table in tables:
      current = scraperwiki.sqlite.select(query)
      if len(current) > 0:
        current = current[0]

        # Check to see if we should overwrite the GHCN data.  Overall, we
        # don't want the GSOD data to overwrite any GHCN data.
        if doNotOverwriteGHCN and current['source'] == 'ghcn':
          return

        # Update data with current data
        current.update(data)
        data = current.copy()

    scraperwiki.sql.save(keys, data, table_name = table)




  # Process GHCN historical data.  Each line is a month of days for a specific
  # measurement
  def process_ghcn(self):
    print 'Reading GHCN file for station: %s (Recent: %s)' % (self.station[0], self.isRecent)
    file_lines = self.read_url(self.ghcn_url_template % { 'ghcn_station': self.station[0] })
    line_offset = 21

    # Read in each line
    print 'Parsing GHCN file for station: %s' % self.station[0]
    for line in file_lines:
      # Parse out the month level data
      month_data = {}
      month_data['source'] = 'ghcn'
      month_data['station'] = line[0:11].strip()
      month_data['year'] = self.read_number_value(line[11:15])
      month_data['month'] = self.read_number_value(line[15:17])
      element = line[17:21].strip().lower()
      element_flags = element + '_f'

      # Only do specific measurements
      if element not in self.ghcn_measurements:
        continue

      # Look for up to 31 values
      for d in range(0, 31):
        segment = line[line_offset + (d * 8):line_offset + (d * 8) + 8]
        if segment is not None and segment.strip() != '':
          # Make day data
          data = month_data.copy()
          data[element_flags] = {}

          # Value
          data[element] = self.read_number_value(segment[0:5], [-9999])

          # Ensure that we have a valid number
          if data[element] is not None:
            # Make date
            data['day'] = d + 1
            data['date'] = dateutil.parser.parse('%s-%s-%s' % (data['year'], data['month'], data['day'])).date()

            # Check if we are in the recent, as this will make things
            # quicker with less db updates
            if self.isRecent and data['date'] < self.recent:
              continue

            # Flags
            if segment[5:6] != ' ':
              data[element_flags]['m'] = segment[5:6]
            if segment[6:7] != ' ':
              data[element_flags]['q'] = segment[6:7]
            if segment[7:8] != ' ':
              data[element_flags]['s'] = segment[7:8]

            # Convert flags to something more friendly
            if len(data[element_flags].keys()) > 0:
              data[element_flags] = json.dumps(data[element_flags])
            else:
              data[element_flags] = None

            # Adjust measurements.  The metric system is better, but unfortunately we
            # will be displaying in US, so might as well do it now
            data[element] = float(data[element])
            if element in ['tmax', 'tmin']:
              data[element] = round(self.to_fahrenheit(data[element] / 10), 2)
            if element in ['prcp', 'snow', 'snwd']:
              data[element] = round(self.to_inches_from_mm(data[element]), 2)

            # Save to GHCN and observations tables
            self.update_data(data, ['station', 'year', 'month', 'day'], 'ghcn')
            self.update_data(data, ['station', 'year', 'month', 'day'], 'observations')

    print 'Done parsing GHCN file for station: %s' % self.station[0]




  # Process Normals data.  The file is in sections for measurements
  # with each line as a month of days
  def process_normals(self):
    print 'Reading Normals file for station: %s' % self.station[0]
    file_lines = self.read_url(self.normals_url_template % { 'ghcn_station': self.station[0], 'year': self.year })
    line_offset = 20

    # Read in each line
    print 'Parsing Normals file for station: %s' % self.station[0]
    for section in self.normals_measurements:
      lines = self.read_normals_section(file_lines, section)

      # Go through each line as month
      for m, line in enumerate(lines):
        # Month level data
        month_data = {}
        month_data['station'] = self.station[0]
        month_data['month'] = m + 1

        # Keep track of previous so that we can make a day value for the
        # month-to-date values
        previous = None

        # Get each day
        for d in range(0, 31):
          # Get each set of value and flag
          segment = line[line_offset + (d * 7):line_offset + (d * 7) + 7]
          if segment is not None and segment.strip() != '':
              value = segment[0:5].strip()
              flag = segment[5:6].strip()

              # Only save when we have a valid value
              if value != '' and value not in ['-9999', '-8888', '-6666', '-5555']:
                value = 0 if value == '-7777' else value
                value = self.read_number_value(value, [-9999])

                # Alter data according to units
                if section[2] == 'temp':
                  value = value * 1.0 / 10
                elif section[2] == 'precip':
                  value = value * 1.0 / 100
                elif section[2] == 'snow':
                  value = value * 1.0 / 10

                # Month to date values.  Subtract from previous origin
                if section[2] in ['precip', 'snow']:
                  orig = value
                  value = round(value - previous, 2) if previous is not None else value
                  previous = orig

                # Start making data
                data = month_data.copy()
                data['day'] = d + 1
                data[section[1]] = value
                data[section[1] + '_f'] = flag if flag != '' else None

                # Make fake date for easier querying
                data['date'] = dateutil.parser.parse('%s-%s-%s' % ('2000', data['month'], data['day'])).date()

                # Save data
                self.update_data(data, ['station', 'month', 'day'], 'normals')

    print 'Done parsing Normals file for station: %s' % self.station[0]

  # Read in section for specific normals measurement.
  def read_normals_section(self, lines, section):
    found = False
    found_index = 0;
    found_lines = []

    # Find section in what is probably a very inefficent way
    for line in lines:
      if line.startswith(section[0]):
        found = True

      if found and found_index < 12:
        found_lines.append(line)
        found_index = found_index + 1

    return found_lines



  # Process GSOD data.  Each line is a day.  We only want recent data
  # but we still may need multiple files
  def process_gsod(self):
    # Determine years
    years = [self.year] if self.year == self.recent_year else [self.year, self.recent_year]
    for year in years:

      print 'Reading GSOD file for station: %s and year: %s' % (self.station[1], year)
      file_lines = self.read_url(self.gsod_url_template % { 'gsod_station': self.station[1], 'year': year })

      # Read in each line
      print 'Parsing GSOD file for station: %s and year: %s' % (self.station[1], year)
      for line in file_lines:
        # Make data
        data = {}
        data['source'] = 'gsod'
        data['station'] = self.station[0]
        data['gsod_station'] = self.station[1]

        # Only update if the line has a number
        if self.is_number(line[0]):
          #data['station'] = line[0:6].strip()
          data['wban'] = line[7:12].strip()
          data['year'] = self.read_number_value(line[14:18])
          data['month'] = self.read_number_value(line[18:20])
          data['day'] = self.read_number_value(line[20:22])
          data['tavg'] = self.read_number_value(line[24:30], [9999.9])
          #data['temp_count'] = read_number_value(line[31:33])
          #data['dew'] = read_number_value(line[35:41], 9999.9)
          #data['dew_count'] = read_number_value(line[42:44])
          #data['slp'] = read_number_value(line[46:51], 9999.9)
          #data['slp_count'] = read_number_value(line[53:54])
          #data['stp'] = read_number_value(line[57:63], 9999.9)
          #data['stp_count'] = read_number_value(line[64:66])
          #data['visibility'] = read_number_value(line[68:73], 999.9)
          #data['visibility_count'] = read_number_value(line[74:76])
          #data['wind'] = read_number_value(line[78:83], 999.9)
          #data['wind_count'] = read_number_value(line[84:86])
          #data['wind_max'] = read_number_value(line[88:93], 999.9)
          #data['wind_gust'] = read_number_value(line[85:100], 999.9)
          data['tmax'] = self.read_number_value(line[102:108], [9999.9])
          #data['temp_max_hourly'] = read_binary_value(line[108:109])
          data['tmin'] = self.read_number_value(line[110:116], [9999.9])
          #data['temp_min_hourly'] = read_binary_value(line[116:117])
          data['prcp'] = self.read_number_value(line[118:123], [99.9])
          data['prcp_f'] = line[123:124].strip()
          data['snwd'] = self.read_number_value(line[125:130], [999.9])
          #data['fog'] = read_binary_value(line[132:133])
          #data['rain'] = read_binary_value(line[133:134])
          #data['snow'] = read_binary_value(line[134:135])
          #data['hail'] = read_binary_value(line[135:136])
          #data['thunder'] = read_binary_value(line[136:137])
          #data['tornado'] = read_binary_value(line[137:138])
          data['date'] = dateutil.parser.parse('%s-%s-%s' % (data['year'], data['month'], data['day'])).date()

          # Save the data to a gsod table and non-destructively add to observations
          if self.isRecent and data['date'] >= self.recent:
            self.update_data(data, ['station', 'year', 'month', 'day'], 'gsod')
            self.update_data(data, ['station', 'year', 'month', 'day'], 'observations', True)

      print 'Done parsing GSOD file for station: %s and year: %s' % (self.station[1], year)



  # Process U of M Climate data.  It is an HTML document with each line
  # as a day as tab delimited
  def process_mn_climate(self):
    # Read in each decade
    for decade in self.mn_decades:
      print 'Reading U of M Climate file for decade: %s' % decade
      file = self.read_url(self.mn_url_template % { 'mn_decade': decade }, True)
      html = BeautifulSoup(''.join(file))

      # Get the text from the page
      print 'Parsing U of M Climate file for decade: %s' % decade
      text = html('font', face = 'Courier New')[0].contents[0]
      lines = text.split('\r\n')
      for l in lines:
        # Aw, the joys of scraping.  Things are /t delimited, well, except for
        # some.
        l = l.replace('    ', '\t')
        line = l.strip().split('\t')

        # Make data if we have a date
        if line[0] is not None and line[0] != '' and self.is_number(line[0]) and self.parse_num(line[0]) > 0:
          data = {}
          data['station'] = self.station[0]
          data['source'] = 'mn_climate'
          data['mn_climate_station'] = 'twin_cities'
          data['year'] = self.parse_num(line[0])
          data['month'] = self.parse_num(line[1])
          data['day'] = self.parse_num(line[2])
          data['tmax'] = self.read_mn_climate_value(line[3])
          data['tmin'] = self.read_mn_climate_value(line[4])
          data['prcp'] = self.read_mn_climate_value(line[5])
          data['snow'] = self.read_mn_climate_value(line[6])
          data['snwd'] = self.read_mn_climate_value(line[7])
          data['date'] = dateutil.parser.parse('%s-%s-%s' % (data['year'], data['month'], data['day'])).date()

          # Save data to mn_climates table and non-destructively to observations
          self.update_data(data, ['station', 'year', 'month', 'day'], 'mn_climate')
          self.update_data(data, ['station', 'year', 'month', 'day'], 'observations', True)

      print 'Done parsing U of M Climate file for decade: %s' % decade


  # Handle flags
  def read_mn_climate_value(self, value):
    # M is missing value
    if value.lower() == 'm':
      value = None
    # Trace amounts are very litte, less than 0.1.  So, we use something that
    # may affect rounding and that's it
    elif value.lower() == 't':
      value = 0.001

    return self.parse_num(value) if value is not None else value



  # Process out the monthly reports from the National Weather Service
  def process_nws_monthly(self):
    section_starter = '============================='

    # We need to determine what months are needed, then get the last date of
    # that month :(
    last_month_days = []
    last_month_days.append(self.last_day_of_month(self.date))
    if self.recent.month != self.date.month:
      last_month_days.append(self.last_day_of_month(self.recent))

    # Go through each last day and read in file
    for last_day in last_month_days:
      print 'Reading NWS monthly data for %s-%s for station: %s,%s' % (last_day.year, last_day.month, self.station[3], self.station[4])
      url_date = '%s-%s-%s' % (last_day.year, last_day.month, last_day.day)
      url = self.nws_monthly_url_template % { 'wfo_id': self.station[3], 'sid_id': self.station[4], 'end_month_date': url_date }
      file = self.read_url(url, True)
      html = BeautifulSoup(''.join(file))

      # Get the text from the HTML
      print 'Parsing NWS monthly data for %s-%s for station: %s,%s' % (last_day.year, last_day.month, self.station[3], self.station[4])
      text = html('font', size = '3')[0].contents[0]
      lines = text.split('\n')
      section_counter = 0

      # Make month data
      month_data = {}
      month_data['source'] = 'nws'
      month_data['station'] = self.station[0]
      month_data['wfo'] = self.station[3]
      month_data['year'] = last_day.year
      month_data['month'] = last_day.month

      # Go through each line, we only want to read what is in the third section
      for l in lines:
        if l.startswith(section_starter):
          section_counter = section_counter + 1
        elif section_counter == 2 and l != '' and l is not None:
          data = month_data.copy()
          data['day'] = self.parse_num(l[0:2].strip())
          data['tmax'] = self.read_mn_climate_value(l[2:6].strip())
          data['tmin'] = self.read_mn_climate_value(l[6:10].strip())
          data['tavg'] = self.read_mn_climate_value(l[10:14].strip())
          data['prcp'] = self.read_mn_climate_value(l[26:31].strip())
          data['snow'] = self.read_mn_climate_value(l[31:36].strip())
          data['snwd'] = self.read_mn_climate_value(l[36:41].strip())

          # Save data to own table and observations
          self.update_data(data, ['station', 'year', 'month', 'day'], 'nws')
          self.update_data(data, ['station', 'year', 'month', 'day'], 'observations', True)





  # Process historical records
  def process_historical(self):
    self.isRecent = False

    for s in self.stations:
      self.station = s
      self.process_ghcn()
      self.process_normals()
      self.process_mn_climate()


  # Process recent records
  def process_recent(self):
    self.isRecent = True

    for s in self.stations:
      self.station = s
      self.process_ghcn()
      self.process_gsod()
      self.process_nws_monthly()



# Main execution
if __name__ == '__main__':
  scraper = DailyWeatherScraper()
  #scraper.process_historical()
  scraper.process_recent()

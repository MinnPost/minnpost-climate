#!/usr/bin/env python

# Scrapes NOAA data to get observation data for every day
# at specific stations in MN

import scraperwiki
import gzip
import urllib2
import StringIO
import dateutil.parser
from datetime import datetime, date, timedelta

# Data source is the NOAA Global Surface Summary Data FTP site.
# ftp://ftp.ncdc.noaa.gov/pub/data/gsod/readme.txt
#
# Each year is in a file like the following:
# ftp://ftp.ncdc.noaa.gov/pub/data/gsod/2014/726580-14922-2014.op.gz
#
# Where 726580-14922 is the station identifier (how to find this?)
#
# Station information can be found here:
# ftp://ftp.ncdc.noaa.gov/pub/data/inventories/ISH-HISTORY.TXT

# What stations to collect
stations = [
    ('726580-14922', 1931)
    # Main minneapolis, though the history says 1931, its actually 1945
    # Missing data 65-72
]
# Location of files
base_url = 'ftp://ftp.ncdc.noaa.gov/pub/data/gsod/%s/%s-%s.op.gz'
# Some basic date values so that we get the recent data
current_year = date.today().year
current_date = date.today()
recent_date = date.today() - timedelta(days = 5)


# Parse out a number
def parse_num(x):
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
def is_number(x):
    x = parse_num(x)
    return isinstance(x, (int, long, float, complex))


# Open remote file, return file
# See: http://stackoverflow.com/questions/16241469/decompress-remote-gz-file-in-python
def open_remote_file(url):
    response = urllib2.urlopen(url)
    compressedFile = StringIO.StringIO()
    compressedFile.write(response.read())
    compressedFile.seek(0)
    decompressedFile = gzip.GzipFile(fileobj = compressedFile, mode = 'rb')
    return decompressedFile


# Readin a value and parse a number
def read_number_value(value, none_amount = 999999):
    value = parse_num(value.strip())
    # These values mean no data
    if value == none_amount:
        return None
    return value


# Checks for a flag value which is binary
def read_binary_value(value):
    if value.strip() == '*' or value.strip() == '1':
        return True
    return False


# Read lines.  Recent means that it will only create or update
# data for the last few days
def process_line(line, recent = False):
    data = {}

    # Only parse lines that start with a nuber
    if is_number(line[0]):
        data['station'] = line[0:6].strip()
        data['wban'] = line[7:12].strip()
        data['year'] = read_number_value(line[14:18])
        data['month'] = read_number_value(line[18:20])
        data['day'] = read_number_value(line[20:22])
        data['temp'] = read_number_value(line[24:30], 9999.9)
        data['temp_count'] = read_number_value(line[31:33])
        data['dew'] = read_number_value(line[35:41], 9999.9)
        data['dew_count'] = read_number_value(line[42:44])
        data['slp'] = read_number_value(line[46:51], 9999.9)
        data['slp_count'] = read_number_value(line[53:54])
        data['stp'] = read_number_value(line[57:63], 9999.9)
        data['stp_count'] = read_number_value(line[64:66])
        data['visibility'] = read_number_value(line[68:73], 999.9)
        data['visibility_count'] = read_number_value(line[74:76])
        data['wind'] = read_number_value(line[78:83], 999.9)
        data['wind_count'] = read_number_value(line[84:86])
        data['wind_max'] = read_number_value(line[88:93], 999.9)
        data['wind_gust'] = read_number_value(line[85:100], 999.9)
        data['temp_max'] = read_number_value(line[102:108], 9999.9)
        data['temp_max_hourly'] = read_binary_value(line[108:109])
        data['temp_min'] = read_number_value(line[110:116], 9999.9)
        data['temp_min_hourly'] = read_binary_value(line[116:117])
        data['precip'] = read_number_value(line[118:123], 99.9)
        data['precip_flag'] = line[123:124].strip()
        data['snow_depth'] = read_number_value(line[125:130], 999.9)
        data['fog'] = read_binary_value(line[132:133])
        data['rain'] = read_binary_value(line[133:134])
        data['snow'] = read_binary_value(line[134:135])
        data['hail'] = read_binary_value(line[135:136])
        data['thunder'] = read_binary_value(line[136:137])
        data['tornado'] = read_binary_value(line[137:138])
        data['date'] = dateutil.parser.parse('%s-%s-%s' % (data['year'], data['month'], data['day'])).date()

        # Save the data
        if recent and data['date'] >= recent_date:
            scraperwiki.sql.save(['station', 'wban', 'year', 'month', 'day'], data)



# Read file and year
def process_station_year(station, year, recent = False):
    url = base_url % (year, station, year)

    try:
        file = open_remote_file(url)
        data = file.readlines()
        for line in data:
            process_line(line, recent)

        print "Processed year %s for station %s. (%s)" % (year, station, ('recent' if recent else 'full'))
        file.close()
    except urllib2.URLError:
        print "Could not find file for year %s for station %s." % (year, station)
    except Exception as ex:
        template = "An exception of type {0} occured. Arguments: \n {1!r}"
        message = template.format(type(ex).__name__, ex.args)
        print message


# Start processing
for station_info in stations:
    station = station_info[0]
    first_year = station_info[1]

    # Historical data
    #for year in range(first_year, current_year):
    #    process_station_year(station, year)

    # Current year
    process_station_year(station, current_year, True)



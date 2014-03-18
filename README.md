# MinnPost Climate

A running look at local, current weather against historical climate patterns.

*Unless otherwise noted, MinnPost projects on [Github](https://github.com/minnpost) are story-driven and meant for transparency sake and not focused on re-use.  For a list of our more reusable projects, go to [code.minnpost.com](http://code.minnpost.com).*

## Data

Data sources are from the National Oceanic and Atmospheric Administration (NOAA) National Climatic Data Center (NCDC) [datasets](http://www.ncdc.noaa.gov/cdo-web/datasets), as well as the state-level [Minnesota Climatology Office](http://climate.umn.edu/) which run through the University of Minnesota.

Ultimately what we want is a daily summary for every day (including today) for a specific location (Twin Cities).  Outside of getting conditions right now, this should be fairly straightforward, but here is why it's not:

* The main Twin Cities weather stations switched from downtown Minneapolis to the MSP Int'l Airport in 1938.
* The GHCN data source (see below) does not seem to have the data for the previous weather station.
* The GHCN data source is not updated daily, meaning that it lags behind a few days.
* Historical data sources do not contain today's data.
* The GSOD data (see below) does not have snow data.

### Data sources

* [NOAA Climatological Normals](http://www.ncdc.noaa.gov/oa/climate/normals/usnormals.html) (1981-2010): "Climate Normals are the latest three-decade averages of climatological variables, including temperature and precipitation."
    * [What are Normals](http://www.ncdc.noaa.gov/oa/climate/normals/usnormals.html#WHATARENORMALS).
    * [Use of Normals](http://www.ncdc.noaa.gov/oa/climate/normals/usnormals.html#NORMALSUSAGE).  "Meteorologists and climatologists regularly use Normals for placing recent climate conditions into a historical context."
* "[Global Historical Climate Network](ftp://ftp.ncdc.noaa.gov/pub/data/ghcn/daily/readme.txt) (GHCN) includes daily observations from around the world. The dataset includes observations from World Meteorological Organization, Cooperative, and CoCoRaHS networks."
    * GHCN does not contain an average temperature, so we use an average of the high and low.
    * GHCN is not up to date and usually lags a few days behind the current date.
    * [GHCN list of stations](ftp://ftp.ncdc.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt)
        * The GHCN Station ID for Minneapolis/St. Paul (MSP) airport is [USW00014922](http://www1.ncdc.noaa.gov/pub/data/normals/1981-2010/products/station/USW00014922.normals.txt).  This can be used for the GHCN and Normals sets (though the GSOD identifiers are different).
* (No longer used) [Global Surface Summary of Day](http://www.ncdc.noaa.gov/cgi-bin/res40.pl?page=gsod.html) (GSOD) which is a global collection of recorded conditions each day.
    * GSOD is used to fill in the most recent data.
    * GSOD does contain an average.
    * GSOD does not contain snowfall data.
    * GSOD is updated at leat once a day, but its data should not be used for today.
* Minnesota Climatology Office [Historical Climate Data Listings for the Twin Cities datasets](http://climate.umn.edu/doc/twin_cities/twin_cities.htm) is used for daily data prior to 1938.
* [Preliminary Monthly Climate Data](http://www.nws.noaa.gov/climate/f6.php?wfo=mpx) provided by the NOAA National Weather Service (NWS)is used to fill in come gaps for recent history (last couple weeks).
* For current day data, we use ????.  

## Data processing

* A scraper is written get the historical and recent data.  It is meant to be run on the [ScraperWiki](https://scraperwiki.com/) platform but can be run locally with the following command and will create a local `scraperwiki.sqlite` database:
    * `python data-processing/daily-scraperwiki.py`
    * You can query the actual scraper with something like the following: `https://premium.scraperwiki.com/d7fssyq/a43576483d6f43a/sql/?q=[[[SQL_QUERY]]]`

## Development and running locally

### Prerequisites

All commands are assumed to on the [command line](http://en.wikipedia.org/wiki/Command-line_interface), often called the Terminal, unless otherwise noted.  The following will install technologies needed for the other steps and will only needed to be run once on your computer so there is a good chance you already have these technologies on your computer.

1. Install [Git](http://git-scm.com/).
   * On a Mac, install [Homebrew](http://brew.sh/), then do: `brew install git`
1. Install [NodeJS](http://nodejs.org/).
   * On a Mac, do: `brew install node`
1. Install [Grunt](http://gruntjs.com/): `npm install -g grunt-cli`
1. Install [Bower](http://bower.io/): `npm install -g bower`
1. Install [Ruby](http://www.ruby-lang.org/en/downloads/), though it may already be on your system.
1. Install [Bundler](http://gembundler.com/), though it may already be on your system: `gem install bundler`
1. Install [Compass](http://compass-style.org/): `gem install compass`
   * On a Mac do: `sudo gem install compass`
1. Install [Python](http://www.python.org/getit/), though it may already be on your system.
1. Install [pip](https://pypi.python.org/pypi/pip): `easy_install pip`
1. (Optional) Use [virtualenv](http://www.virtualenv.org/en/latest/), where `.env` is an environment name that you can change if you want.
    1. `easy_install virtualenv`
    1. `virtualenv .env`
    1. `cd .env && source bin/activiate; cd -;`


### Get code and install packages

Get the code for this project and install the necessary dependency libraries and packages.

1. Check out this code with [Git](http://git-scm.com/): `git clone https://github.com/MinnPost/minnpost-climate.git`
1. Go into the template directory: `cd minnpost-climate`
1. Install NodeJS packages: `npm install`
1. Install Bower components: `bower install`
1. Install Python packages: `pip install -r requirements.txt`

### Running

1. Run: `grunt server`
    * This will run a local webserver for development and you can view the application in your web browser at [http://localhost:8804](http://localhost:8804).
    * Utilize `index.html` for development, while `index-deploy.html` is used for the deployed version, and `index-build.html` is used to test the build before deployment.
    * The server runs `grunt watch` which will watch for linting JS files and compiling SASS.  If you have your own webserver, feel free to use that with just this command.

### Build

To build or compile all the assets together for easy and efficient deployment, do the following.  It will create all the files in the `dist/` folder.

1. Run: `grunt`

### Deploy

Deploying will push the relevant files up to Amazon's AWS S3 so that they can be easily referenced on the MinnPost site.  This is specific to MinnPost, and your deployment might be different.

1. Run: `grunt deploy`

## Hacks

*List any hacks used in this project, such as forked repos.  Link to pull request or repo and issue.*

# MinnPost Climate

A running look at local, current weather against historical climate patterns.

*Unless otherwise noted, MinnPost projects on [Github](https://github.com/minnpost) are story-driven and meant for transparency sake and not focused on re-use.  For a list of our more reusable projects, go to [code.minnpost.com](http://code.minnpost.com).*

## Data

Two main sources are used for this application.

* [NOAA Climatological Normals](http://www.ncdc.noaa.gov/oa/climate/normals/usnormals.html) (1981-2010): "Climate Normals are the latest three-decade averages of climatological variables, including temperature and precipitation."
    * [What are Normals](http://www.ncdc.noaa.gov/oa/climate/normals/usnormals.html#WHATARENORMALS).
    * [Use of Normals](http://www.ncdc.noaa.gov/oa/climate/normals/usnormals.html#NORMALSUSAGE).  "Meteorologists and climatologists regularly use Normals for placing recent climate conditions into a historical context."
* [Global Surface Summary of Day](http://www.ncdc.noaa.gov/cgi-bin/res40.pl?page=gsod.html) (GSOD) which is a global collection of recorded conditions each day.

## Data processing

* For the Normals, this data does not get updated (except each decade), so we store locally and use directly in application.  Run the following to download and parse the Normals data:
    * `node data-processing/station-normals.js`
    * This will create files in the `data` directory like `data/[[[STATION]]]-daily.json`.
* For the historical GSOD data, we need to update this daily, so we use [ScraperWiki](https://scraperwiki.com/) to process the data and create an API.  A (not-guaranteed to be up-to-date) copy of the scraper can be found in `data-processing/daily-observations-scraperwiki.py`.
    * You can query this data with: `https://premium.scraperwiki.com/bd5okny/ec1140c12061447/sql/?q=[[[SQL_QUERY]]]`

## Development and running locally

### Prerequisites

All commands are assumed to on the [command line](http://en.wikipedia.org/wiki/Command-line_interface), often called the Terminal, unless otherwise noted.  The following will install technologies needed for the other steps and will only needed to be run once on your computer so there is a good chance you already have these technologies on your computer.

1. Install [Git](http://git-scm.com/).
   * On a Mac, install [Homebrew](http://brew.sh/), then do: `brew install git`
1. Install [NodeJS](http://nodejs.org/).
   * On a Mac, do: `brew install node`
1. Optionally, for development, install [Grunt](http://gruntjs.com/): `npm install -g grunt-cli`
1. Install [Bower](http://bower.io/): `npm install -g bower`
1. Install [Ruby](http://www.ruby-lang.org/en/downloads/), though it is probably already installed on your system.
1. Install [Bundler](http://gembundler.com/): `gem install bundler`
1. Install [Sass](http://sass-lang.com/): `gem install sass`
   * On a Mac do: `sudo gem install sass`
   1. Install [Compass](http://compass-style.org/): `gem install compass`
   * On a Mac do: `sudo gem install compass`


### Get code and install packages

Get the code for this project and install the necessary dependency libraries and packages.

1. Check out this code with [Git](http://git-scm.com/): `git clone https://github.com/MinnPost/minnpost-climate.git`
1. Go into the template directory: `cd minnpost-climate`
1. Install NodeJS packages: `npm install`
1. Install Bower components: `bower install`

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

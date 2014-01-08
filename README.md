# MinnPost Climate

A running look at local, current weather against historical climate patterns.

*Unless otherwise noted, MinnPost projects on [Github](https://github.com/minnpost) are story-driven and meant for transparency sake and not focused on re-use.  For a list of our more reusable projects, go to [code.minnpost.com](http://code.minnpost.com).*

## Data

Weather data provided by [hamweather.com](http://www.hamweather.com/).

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

/* global module:false */

/**
 * Grunt file that handles managing tasks such as rendering
 * SASS, providing a basic HTTP server, building a
 * distribution, and deploying.
 */
module.exports = function(grunt) {
  var _ = grunt.util._;

  /**
   * Maintain list of libraries here.
   *
   * Order matters for build.
   */
  var components = grunt.file.readJSON('bower_map.json');

  // Project configuration.  Many values are directly read from
  // package.json.
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    meta: {
      banner: '/*! <%= pkg.title || pkg.name %> - v<%= pkg.version %> - ' +
        '<%= grunt.template.today("yyyy-mm-dd") + "\\n" %>' +
        '<%= pkg.homepage ? "* " + pkg.homepage + "\\n" : "" %>' +
        '* Copyright (c) <%= grunt.template.today("yyyy") %> <%= pkg.author.name %>;' +
        ' Licensed <%= pkg.license || _.pluck(pkg.licenses, "type").join(", ") %> */' +
        '<%= "\\n\\n" %>',
      bannerLatest: '/*! <%= pkg.title || pkg.name %> - LATEST VERSION - ' +
        '<%= grunt.template.today("yyyy-mm-dd") + "\\n" %>' +
        '<%= pkg.homepage ? "* " + pkg.homepage + "\\n" : "" %>' +
        '* Copyright (c) <%= grunt.template.today("yyyy") %> <%= pkg.author.name %>;' +
        ' Licensed <%= pkg.license || _.pluck(pkg.licenses, "type").join(", ") %> */' +
        '<%= "\\n\\n" %>'
    },
    components: components,

    // Clean up the distribution fold
    clean: {
      folder: 'dist/'
    },

    // JS Hint checks code for coding styles and possible errors
    jshint: {
      options: {
        curly: true,
        //es3: true,
        forin: true,
        latedef: true,
        //maxlen: 80,
        indent: 2
      },
      files: ['Gruntfile.js', 'js/*.js', 'data-processing/*.js']
    },


    // Compass is an extended SASS.  Set it up so that it generates to .tmp/
    compass: {
      options: {
        sassDir: 'styles',
        cssDir: '.tmp/css',
        generatedImagesDir: '.tmp/images',
        fontsDir: 'styles/fonts',
        imagesDir: 'images',
        javascriptsDir: 'js',
        importPath: 'bower_components',
        httpPath: './',
        relativeAssets: true
      },
      dist: {
        options: {
          environment: 'production',
          outputStyle: 'compressed',
          relativeAssets: false,
          cssDir: '.tmp/dist_css'
        }
      },
      dev: {
        options: {
          debugInfo: true
        }
      }
    },


    // Copy relevant files over to distribution
    copy: {
      images: {
        files: [
          {
            cwd: './images/',
            expand: true,
            src: ['**'],
            dest: 'dist/images/'
          }
        ]
      },
      data: {
        files: [
          {
            cwd: './data/',
            expand: true,
            filter: 'isFile',
            src: ['**/*.json'],
            dest: 'dist/data/'
          }
        ]
      }
    },


    // R.js to bring together files through requirejs.  We exclude libraries
    // and compile them separately.
    requirejs: {
      app: {
        options: {
          name: 'minnpost-climate',
          exclude: _.compact(_.flatten(_.pluck(_.filter(components, function(c) { return (c.js !== undefined); }), 'rname'))),
          baseUrl: 'js',
          mainConfigFile: 'js/config.js',
          out: 'dist/<%= pkg.name %>.latest.js',
          optimize: 'none'
        }
      },
      libs: {
        options: {
          include: _.compact(_.flatten(_.pluck(_.filter(components, function(c) { return (c.js !== undefined); }), 'rname'))),
          baseUrl: 'js',
          mainConfigFile: 'js/config.js',
          out: 'dist/<%= pkg.name %>.libs.js',
          optimize: 'none'
        }
      }
    },


    // Brings files toggether

    concat: {
      options: {
        separator: '\r\n\r\n'
      },
      // JS version
      js: {
        src: ['dist/<%= pkg.name %>.latest.js'],
        dest: 'dist/<%= pkg.name %>.<%= pkg.version %>.js'
      },
      // CSS
      css: {
        src: [

          '<%= compass.dist.options.cssDir %>/main.css'
        ],
        dest: 'dist/<%= pkg.name %>.<%= pkg.version %>.css'
      },
      cssLatest: {
        src: ['<%= concat.css.src %>'],
        dest: 'dist/<%= pkg.name %>.latest.css'
      },
      cssIe: {
        src: [

          '<%= compass.dist.options.cssDir %>/main.ie.css'
        ],
        dest: 'dist/<%= pkg.name %>.<%= pkg.version %>.ie.css'
      },
      cssIeLatest: {
        src: ['<%= concat.cssIe.src %>'],
        dest: 'dist/<%= pkg.name %>.latest.ie.css'
      },
      // CSS Libs
      cssLibs: {
        src: ['<%= _.map(_.compact(_.flatten(_.pluck(components, "css"))), function(c) { return "bower_components/" + c + ".css"; }) %>'],
        dest: 'dist/<%= pkg.name %>.libs.css'
      },
      cssIeLibs: {
        src: ['<%= _.map(_.compact(_.flatten(_.pluck(components, "ie"))), function(c) { return "bower_components/" + c + ".css"; }) %>'],
        dest: 'dist/<%= pkg.name %>.libs.ie.css'
      }
    },


    // Minify JS for network efficiency
    uglify: {
      options: {
        banner: '<%= meta.banner %>'
      },
      dist: {
        src: ['<%= concat.js.dest %>'],
        dest: 'dist/<%= pkg.name %>.<%= pkg.version %>.min.js'
      },
      distLatest: {
        options: {
          banner: '<%= meta.bannerLatest %>'
        },
        src: ['<%= concat.js.dest %>'],
        dest: 'dist/<%= pkg.name %>.latest.min.js'
      }
    },

    // Minify CSS for network efficiency
    cssmin: {
      options: {
        banner: '<%= meta.banner %>',
        report: true
      },
      css: {
        src: ['<%= concat.css.dest %>'],
        dest: 'dist/<%= pkg.name %>.<%= pkg.version %>.min.css'
      },
      cssLatest: {
        options: {
          banner: '<%= meta.bannerLatest %>'
        },
        src: ['<%= concat.css.dest %>'],
        dest: 'dist/<%= pkg.name %>.latest.min.css'
      },
      cssIe: {
        src: ['<%= concat.cssIe.dest %>'],
        dest: 'dist/<%= pkg.name %>.<%= pkg.version %>.min.ie.css'
      },
      cssIeLatest: {
        options: {
          banner: '<%= meta.bannerLatest %>'
        },
        src: ['<%= concat.cssIe.dest %>'],
        dest: 'dist/<%= pkg.name %>.latest.min.ie.css'
      }
    },

    // Deploy to S3
    s3: {
      options: {
        // This is specific to MinnPost
        //
        // These are assumed to be environment variables:
        //
        // AWS_ACCESS_KEY_ID
        // AWS_SECRET_ACCESS_KEY
        //
        // See https://npmjs.org/package/grunt-s3
        //key: 'YOUR KEY',
        //secret: 'YOUR SECRET',
        bucket: 'data.minnpost',
        access: 'public-read'
      },
      mp_deploy: {
        upload: [
          {
            src: 'dist/*',
            dest: 'projects/<%= pkg.name %>/'
          },
          {
            src: 'dist/data/**/*',
            dest: 'projects/<%= pkg.name %>/data/',
            rel: 'dist/data'
          },
          {
            src: 'dist/images/**/*',
            dest: 'projects/<%= pkg.name %>/images/',
            rel: 'dist/images'
          }
        ]
      }
    },
    // HTTP Server
    connect: {
      server: {
        options: {
          port: 8804
        }
      }
    },
    // Watches files for changes and performs task
    watch: {
      files: ['<%= jshint.files %>', 'styles/*.scss'],
      tasks: 'watcher'
    }
  });

  // Load plugin tasks
  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-compass');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-contrib-connect');
  grunt.loadNpmTasks('grunt-contrib-requirejs');
  grunt.loadNpmTasks('grunt-contrib-cssmin');
  grunt.loadNpmTasks('grunt-s3');



  // Default build task
  grunt.registerTask('default', ['jshint', 'compass:dist', 'clean', 'copy', 'requirejs', 'concat', 'cssmin', 'uglify']);

  // Watch tasks

  grunt.registerTask('watcher', ['jshint', 'compass:dev']);
  grunt.registerTask('server', ['compass:dev', 'connect', 'watch']);


  // Deploy tasks
  grunt.registerTask('deploy', ['s3']);

};

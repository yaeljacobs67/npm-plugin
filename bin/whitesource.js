#!/usr/bin/env node

'use strict';

process.title = 'whitesource';

var shell = require('shelljs/global');
var cli = require('cli');
var fs = require('fs');
var Q = require('q');
var checksum = require('checksum');

var prompt = require('prompt');
prompt.message = "whitesource";
prompt.delimiter = ">".green;

var runtime = new Date().valueOf();

var WsCheckPol = require('./ws_check_pol');
var WsNodeReportBuilder = require('./ws_node_report_builder');
var WsBowerReportBuilder = require('./ws_bower_report_builder');
var WsPost = require('./ws_post');
var WsHelper = require('./ws_helper');
var runtimeMode = "node";

var finish = function(){
	//TODO: rename/remove shrinkwrap file to avoid npm to use hardcoded versions.
	var timer = new Date().valueOf() - runtime;
	timer = timer / 1000;
	cli.ok('Build success!' + " ( took: " + timer +"s ) " );
	//process.exit(0);
};

var buildCallback = function(isSuc,resJson){
	var fileName = (runtimeMode === "node") ? "response-npm.json" : "response-bower.json";
	if(isSuc){
		WsHelper.saveReportFile(resJson,fileName);
		cli.ok(resJson);
		finish();
	}else{
		//process.exit(1);
	}
};

var postReportToWs = function(report,confJson){
	cli.ok('Getting ready to post report to WhiteSource...');
	if(runtimeMode === "node"){
		WsPost.postNpmUpdateJson(report,confJson,buildCallback);
	}else{
		WsPost.postBowerUpdateJson(report,confJson,buildCallback);
	}
};

var buildReport = function(shrinkwrapJson){
	cli.ok("Building dependencies report");

	if(runtimeMode === "node"){
		var jsonFromShrinkwrap = WsNodeReportBuilder.traverseShrinkWrapJson(shrinkwrapJson);
		var resJson = jsonFromShrinkwrap;
	}else{
		var bowerJsonReport = WsBowerReportBuilder.buildReport();
		var resJson = bowerJsonReport;
	}
	return resJson;
};

cli.parse(null, ['bower','run']);
cli.main(function (args, options){
	var confJson = WsHelper.initConf();
	var shrinkwrapFailMsg = 'Failed to run NPM shrinkwrap, \n make sure to run NPM install prior to running whitesource, \n if this problem continues please check your Package.json for invalid cofigurations'
	var shrinkwrapDevDepMsg = 'If you have installed Dev Dependencies and like to include them in the whitesource report,\n add devDep flag to the whitesource.config file to continue.'
	var missingPackgeJsonMsg = 'Missing Package.json file. \n whitesource requires a valid package.json file to proceed'
	
	if(cli.command === "run"){
		runtimeMode = "node";
		cli.ok('Running whitesource...');
		var hasPackageJson = WsHelper.hasFile('./package.json');
		if(!hasPackageJson){
			cli.fatal(missingPackgeJsonMsg);
		}

		var cmd = (confJson.devDep === "true") ? 'npm shrinkwrap --dev' : 'npm shrinkwrap';
		exec(cmd,function(error, stdout, stderr){
		    if (error != 0){
		    	cli.ok('exec error: ', error);
		    	cli.error(shrinkwrapDevDepMsg)
		    	cli.fatal(shrinkwrapFailMsg);
		    } else {
				cli.ok('Done shrinkwrapping!');
				cli.ok('Reading shrinkwrap report');

				var shrinkwrap = JSON.parse(fs.readFileSync("./npm-shrinkwrap.json", 'utf8'));
				var json = buildReport(shrinkwrap);

				cli.ok("Saving dependencies report");
				WsHelper.saveReportFile(json,"npm-report");

				postReportToWs(json,confJson);
		    }
		});
		
	}

	if(cli.command === "bower"){
		runtimeMode = "bower";

		cli.ok('Checking Bower Dependencies...');
		var json = buildReport();

		cli.ok("Saving bower dependencies report");

		//general project name version
		WsHelper.saveReportFile(json.report,"bower-report");

		//deps report
		WsHelper.saveReportFile(json.deps,"bower-deps-report"); 
		postReportToWs(json,confJson);
	}
});
#!/usr/bin/env node

'use strict';

process.title = 'whitesource';

var shell = require('shelljs/global');
var cli = require('cli');
var fs = require('fs');
var checksum = require('checksum');

var prompt = require('prompt');
prompt.message = "whitesource";
prompt.delimiter = ">".green;

var runtime = new Date().valueOf();

var WsCheckPol = require('./ws_check_pol');
var constants = require('./constants');
var WsNodeReportBuilder = require('./ws_node_report_builder');
var WsBowerReportBuilder = require('./ws_bower_report_builder');
var WsPost = require('./ws_post');
var WsHelper = require('./ws_helper');
var runtimeMode = "node";
const checkPolicyField = "checkPolicies";
const bowerReportName = "bower-report";
const bowerDepsReport = "bower-deps-report";

var finish = function(){
	//TODO: rename/remove shrinkwrap file to avoid npm to use hardcoded versions.
	var timer = new Date().valueOf() - runtime;
	timer = timer / 1000;
	cli.ok('Build success!' + " ( took: " + timer +"s ) " );
	//process.exit(0);
};

var buildCallback = function(isSuc,resJson){
	var fileName = (runtimeMode === "node") ? constants.NPM_RESPONSE_JSON : constants.BOWER_RESPONSE_JSON;
	if(isSuc){
		WsHelper.saveReportFile(resJson,fileName);
		cli.ok(resJson);
		finish();
	}else{
		//process.exit(1);
	}
};

var getRejections = function(resJson) {
	var cleanRes = WsHelper.cleanJson(resJson);
	var response = JSON.parse(cleanRes);
	var responseData = JSON.parse(response.data);
	var violations = [];
	function checkRejection(child) {
		if (child.hasOwnProperty('policy') && child.policy.actionType === "Reject") {
			//cli.error("Policy violation found! Package: " + child.resource.displayName + " | Policy: " + child.policy.displayName);
			var toPush = {};
			toPush.policy = child.policy;
			delete toPush.policy.filterLogic;
			toPush.resource = child.resource;
			violations.push(toPush);
		}
		child.children.forEach(checkRejection);
	}

	function projectHasRejections(project) {
		if (project.hasOwnProperty("children")) {
			project.children.forEach(checkRejection);
		}
	}
	if (responseData.hasOwnProperty("existingProjects")) {
		var existingProjects = responseData.existingProjects;
		for (var key in existingProjects) {
			// skip loop if the property is from prototype
			if (!existingProjects.hasOwnProperty(key)) continue;

			var obj = existingProjects[key];
			projectHasRejections(obj);
		}
	}
	if (responseData.hasOwnProperty("newProjects")) {
		var newProjects = responseData.newProjects;
		for (var key in newProjects) {
			// skip loop if the property is from prototype
			if (!newProjects.hasOwnProperty(key)) continue;

			var obj = newProjects[key];
			projectHasRejections(obj);
		}
	}
	return violations;
};

var postReportToWs = function(report,confJson){
	function checkPolicyCallback(isSuc, resJson) {
		if (isSuc) {
			cli.info("Checking Policies");
			var violations = getRejections(resJson);
			if (violations.length == 0) {
				cli.ok("No policy violations. Posting update request");
				if (runtimeMode === "node") {
					WsPost.postNpmJson(report, confJson, false, buildCallback);
				} else {
					WsPost.postBowerJson(report, confJson, false, buildCallback);
				}
			} else {
				cli.info("Some dependencies did not conform with open source policies, review report for details");
				WsHelper.saveReportFile(violations, constants.POLICY_VIOLATIONS);
				cli.info("=== UPDATE ABORTED ===");
			}
		} else {
			cli.info("Couldn't check licenses");
		}

	}
	cli.ok('Getting ready to post report to WhiteSource...');
	if(runtimeMode === "node"){
		//WsPost.postNpmUpdateJson(report,confJson,buildCallback);
		if (confJson.hasOwnProperty(checkPolicyField) && confJson.checkPolicies) {
			WsPost.postNpmJson(report, confJson, true, checkPolicyCallback);
		} else {
			WsPost.postNpmJson(report, confJson, false, buildCallback);
		}
	}else{
		if (confJson.hasOwnProperty(checkPolicyField) && confJson.checkPolicies) {
			WsPost.postBowerJson(report, confJson, true, checkPolicyCallback);
		} else {
			WsPost.postBowerJson(report, confJson, false, buildCallback);
		}
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

var deletePluginFiles = function () {
	var pathPrefix = "./ws-log-";
	if (runtimeMode === "node") {
		fs.unlink(pathPrefix + constants.NPM_RESPONSE_JSON, unlinkCallback);
		fs.unlink(pathPrefix + constants.NPM_REPORT_NAME, unlinkCallback);
		fs.unlink(pathPrefix + constants.NPM_DEPS_REPORT, unlinkCallback);
		fs.unlink(pathPrefix + constants.NPM_REPORT_JSON, unlinkCallback);
		fs.unlink(pathPrefix + constants.NPM_REPORT_POST_JSON, unlinkCallback);
	} else {
		fs.unlink(pathPrefix + constants.BOWER_RESPONSE_JSON, unlinkCallback);
		fs.unlink(pathPrefix + constants.BOWER_REPORT_NAME, unlinkCallback);
		fs.unlink(pathPrefix + constants.BOWER_DEPS_REPORT, unlinkCallback);
		fs.unlink(pathPrefix + constants.BOWER_REPORT_JSON, unlinkCallback);
		fs.unlink(pathPrefix + constants.BOWER_REPORT_POST_JSON, unlinkCallback);
	}
	fs.unlink(pathPrefix + constants.POLICY_VIOLATIONS, unlinkCallback);

	function unlinkCallback(err) {}
};


cli.parse(null, ['bower','run']);
cli.main(function (args, options){
	var confJson = WsHelper.initConf();
	var shrinkwrapFailMsg = 'Failed to run NPM shrinkwrap, \n make sure to run NPM install prior to running whitesource, \n if this problem continues please check your Package.json for invalid cofigurations'
	var shrinkwrapDevDepMsg = 'If you have installed Dev Dependencies and like to include them in the whitesource report,\n add devDep flag to the whitesource.config file to continue.'
	var missingPackgeJsonMsg = 'Missing Package.json file. \n whitesource requires a valid package.json file to proceed'

	deletePluginFiles();

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
				WsHelper.saveReportFile(json,constants.NPM_REPORT_NAME);

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
		WsHelper.saveReportFile(json.report,constants.BOWER_REPORT_NAME);

		//deps report
		WsHelper.saveReportFile(json.deps,constants.BOWER_DEPS_REPORT);
		postReportToWs(json,confJson);
	}
});
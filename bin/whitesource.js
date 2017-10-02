#!/usr/bin/env node

'use strict';

process.title = 'whitesource';

var shell = require('shelljs/global');
var cli = require('cli');
var fs = require('fs');
var mkdirp = require('mkdirp');
var checksum = require('checksum');

var prompt = require('prompt');
prompt.message = "whitesource";
prompt.delimiter = ">".green;

var runtime = new Date().valueOf();

var constants = require('./constants');
var WsNodeReportBuilder = require('./ws_node_report_builder');
var WsBowerReportBuilder = require('./ws_bower_report_builder');
var WsPost = require('./ws_post');
var WsHelper = require('./ws_helper');
var version = require('./version');

var runtimeMode = "node";
var isFailOnError = false;
var isPolicyViolation = false;
var isForceUpdate = false;
var timeout = 3600000;
var isDebugMode = false;

const checkPolicyField = "checkPolicies";
const forceUpdateField = "forceUpdate";
const failOnErrorField = "failOnError";
const timeoutField = "timeoutMinutes";
const debugModeField = "debugMode";

var finish = function(){
	//TODO: rename/remove shrinkwrap file to avoid npm to use hardcoded versions.
	var timer = new Date().valueOf() - runtime;
	timer = timer / 1000;
	cli.ok('Build success!' + " ( took: " + timer +"s ) " );
	process.exit(0);
};

var buildCallback = function(isSuc,resJson){
	var fileName = (runtimeMode === "node") ? constants.NPM_RESPONSE_JSON : constants.BOWER_RESPONSE_JSON;
	if(isSuc && !(isFailOnError && isPolicyViolation)){
		if (isDebugMode) {
            WsHelper.saveReportFile(resJson,fileName);
		}
		cli.ok(resJson);
		finish();
	}else{
		if (isFailOnError && isPolicyViolation) {
			cli.error("Some dependencies were rejected by the organization's policies");
			cli.error("Build failed!")
		}
		process.exit(1);
	}
};

var getRejections = function(resJson) {
	var cleanRes = WsHelper.cleanJson(resJson);
	var response = JSON.parse(cleanRes);
	try {
        var responseData = JSON.parse(response.data);
	} catch (e) {
		cli.error("Failed to find policy violations.")
		return null;
	}
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
		for (var existingProject in existingProjects) {
			// skip loop if the property is from prototype
			if (!existingProjects.hasOwnProperty(existingProject)) continue;

			var proj = existingProjects[existingProject];
			projectHasRejections(proj);
		}
	}
	if (responseData.hasOwnProperty("newProjects")) {
		var newProjects = responseData.newProjects;
		for (var newProject in newProjects) {
			// skip loop if the property is from prototype
			if (!newProjects.hasOwnProperty(newProject)) continue;

			var obj = newProjects[newProject];
			projectHasRejections(obj);
		}
	}
	return violations;
};

function abortUpdate() {
	cli.info("=== UPDATE ABORTED ===");
	process.exit(1);
}
var postReportToWs = function(report,confJson){
	function checkPolicyCallback(isSuc, resJson) {
		if (isSuc) {
			cli.info("Checking Policies");
			var violations = getRejections(resJson);
			if (violations != null && violations.length == 0) {
				cli.ok("No policy violations. Posting update request");
				if (runtimeMode === "node") {
					WsPost.postNpmJson(report, confJson, false, buildCallback, timeout, isDebugMode);
				} else {
					WsPost.postBowerJson(report, confJson, false, buildCallback, timeout, isDebugMode);
				}
			} else if (violations == null) {
				try {
                    if (isForceUpdate) {
                        cli.info("Force updating");
                        if (runtimeMode === "node") {
                            WsPost.postNpmJson(report, confJson, false, buildCallback, timeout, isDebugMode);
                        } else {
                            WsPost.postBowerJson(report, confJson, false, buildCallback, timeout, isDebugMode);
                        }
                    } else if (!isFailOnError) {
                        // Not forceUpdate and not to failOnError
                        cli.ok("Ignoring policy violations.");
                        finish();
                    } else if (isFailOnError) {
                        abortUpdate();
                    }
                } catch (e) {
                    cli.error(e);
                    abortUpdate();
				}
            } else {
				try{
					isPolicyViolation = true;
					cli.error("Some dependencies did not conform with open source policies");
					fs.writeFile("ws-log-" + constants.POLICY_VIOLATIONS, JSON.stringify(violations, null, 4), function(err) {
						if(err){
							cli.error(err);
							abortUpdate();
						}else {
							cli.info("review report for details (ws-log-"
								+ constants.POLICY_VIOLATIONS + ")");
							if (isForceUpdate) {
								cli.info("There are policy violations. Force updating...");
								if (runtimeMode === "node") {
									WsPost.postNpmJson(report, confJson, false, buildCallback, timeout, isDebugMode);
								} else {
									WsPost.postBowerJson(report, confJson, false, buildCallback, timeout, isDebugMode);
								}
							} else if (!isFailOnError) {
								// Not forceUpdate and not to failOnError
								cli.ok("Ignoring policy violations.");
								finish();
							} else if (isFailOnError) {
								abortUpdate();
							}
						}
					});
				}catch(e){
					cli.error(e);
					abortUpdate();
				}
			}
		} else {
			cli.info("Couldn't post to server");
			if (resJson) {
                cli.error(resJson);
			}
			process.exit(1);
		}
	}
	cli.ok('Getting ready to post report to WhiteSource...');
	var checkPolicies = confJson.hasOwnProperty(checkPolicyField) && (confJson.checkPolicies === true || confJson.checkPolicies === "true");
	if(runtimeMode === "node"){
		//WsPost.postNpmUpdateJson(report,confJson,buildCallback);
		if (checkPolicies) {
			WsPost.postNpmJson(report, confJson, true, checkPolicyCallback, timeout, isDebugMode);
		} else {
			WsPost.postNpmJson(report, confJson, false, buildCallback, timeout, isDebugMode);
		}
	}else{
		if (checkPolicies) {
			WsPost.postBowerJson(report, confJson, true, checkPolicyCallback, timeout, isDebugMode);
		} else {
			WsPost.postBowerJson(report, confJson, false, buildCallback, timeout, isDebugMode);
		}
	}
};

var deletePluginFiles = function () {
	var pathPrefix = "./" + constants.LOG_FILES_FOLDER + "/ws-log-";
	if (runtimeMode === "node") {
		fs.unlink("./" + constants.LOG_FILES_FOLDER + "/ws-" + constants.NPM_LS_JSON, unlinkCallback);
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

var deleteNpmLsAndFolderIfNotDebougMode = function () {
	if (!isDebugMode) {
        fs.unlink("./ws-" + constants.NPM_LS_JSON, unlinkCallback);
        fs.rmdir(constants.LOG_FILES_FOLDER, function (err) {});
	}
    function unlinkCallback(err) {};
};

var buildReport = function(lsJson){
	if(runtimeMode === "node"){
		var jsonFromLs = WsNodeReportBuilder.traverseLsJson(lsJson);
		var resJson = jsonFromLs;
	} else {
		var bowerJsonReport = WsBowerReportBuilder.buildReport();
		var resJson = bowerJsonReport;
	}
	return resJson;
};

var getNpmLsPath = function() {
	var path = "";
	if (isDebugMode) {
		path = "./" + constants.LOG_FILES_FOLDER + "/ws-ls.json";
	} else {
		path = "./ws-ls.json";
	}
	return path;
};

cli.setApp(constants.APP_NAME, version);
cli.enable('version');
cli.parse(null, ['bower','run']);
cli.main(function (args, options){
	var confPath = './whitesource.config.json';
	if (options.hasOwnProperty('c') && options.c && args.length > 0) {
		confPath = args[0];
	}
	var confJson = WsHelper.initConf(confPath);
	if (!confJson) abortUpdate();
	isFailOnError = confJson.hasOwnProperty(failOnErrorField) && (confJson.failOnError === true || confJson.failOnError === "true");
	isForceUpdate = confJson.hasOwnProperty(forceUpdateField) && (confJson.forceUpdate === true || confJson.forceUpdate === "true");
    isDebugMode = confJson.hasOwnProperty(debugModeField) && (confJson.debugMode === true || confJson.debugMode === "true");
	if (confJson.hasOwnProperty(timeoutField)) {
		timeout = confJson.timeoutMinutes * 60 * 1000;
	}
	cli.ok('Config file is located in: ' + confPath);
	var lsFailMsg = 'Failed to run NPM ls, \n make sure to run NPM install prior to running whitesource, \n if this problem continues please check your Package.json for invalid configurations'
	var devDepMsg = 'If you have installed Dev Dependencies and like to include them in the whitesource report,\n add devDep flag to the whitesource.config file to continue.'
	var missingPackageJsonMsg = 'Missing Package.json file. \n whitesource requires a valid package.json file to proceed';

    if(cli.command === "bower") {
        runtimeMode = "bower";
    }

	deletePluginFiles();

	if (isDebugMode) {
        mkdirp("./" + constants.LOG_FILES_FOLDER, function(err) {
            if (err) {
                cli.error(err);
            }
        });
	}

	// if(cli.command === "-v"){
	// 	process.stdout.write(version + '\n');
	// 	process.exit();
	// }
	if(cli.command === "run"){
		runtimeMode = "node";
		cli.ok('Running whitesource...');
		var hasPackageJson = WsHelper.hasFile('./package.json');
		if(!hasPackageJson){
			cli.fatal(missingPackageJsonMsg);
		}
		var pathOfNpmLsFile = getNpmLsPath();
		var cmd = (confJson.devDep === true) ? "npm ls --json > " + pathOfNpmLsFile : "npm ls --json --only=prod > " + pathOfNpmLsFile;
		exec(cmd,function(error, stdout, stderr){
		    if (error != 0){
                deleteNpmLsAndFolderIfNotDebougMode();
		    	cli.ok('exec error: ', error);
		    	cli.error(devDepMsg);
		    	cli.fatal(lsFailMsg);
		    } else {
				cli.ok('Done calculation dependencies!');

				var lsResult = JSON.parse(fs.readFileSync(pathOfNpmLsFile, 'utf8'));
				var json = buildReport(lsResult);
                deleteNpmLsAndFolderIfNotDebougMode();

				cli.ok("Saving dependencies report");

				if (isDebugMode) {
                    WsHelper.saveReportFile(json,constants.NPM_REPORT_NAME);
				}

				postReportToWs(json,confJson);
		    }
		});
	}

	if(runtimeMode == "bower"){
		cli.ok('Checking Bower Dependencies...');
		var json = buildReport();

		cli.ok("Saving bower dependencies report");

		if (isDebugMode) {
            //general project name version
            WsHelper.saveReportFile(json.report,constants.BOWER_REPORT_NAME);

            //deps report
            WsHelper.saveReportFile(json.deps,constants.BOWER_DEPS_REPORT);
		} else {
            fs.rmdir(constants.LOG_FILES_FOLDER, function (err) {});
		}

		postReportToWs(json,confJson);
	}
});
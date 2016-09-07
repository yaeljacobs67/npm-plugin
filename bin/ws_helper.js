var WsHelper = exports;
exports.constructor = function WsHelper(){};

var fs = require('fs');
var cli = require('cli');

var noConfMsg = 'Please create a whitesource.config.json to continue';
var fileMsg = 'whitesource.config.json is not a valid JSON file';


WsHelper.hasFile = function(filePath){
    try{
        return fs.statSync(filePath).isFile();
    }
    catch (err){
        return false;
    }
};

WsHelper.initConf = function(){
	 try{
		res = fs.readFileSync('./whitesource.config.json', 'utf8',function(err,data){
			if(!err){
				cli.error(fileMsg);
				return false;
			}
		});	
		res = JSON.parse(res);
	}catch(e){
		cli.error(noConfMsg);
		return false;
	}

	return res;

};

WsHelper.saveReportFile = function(json,filename){
	try{
		fs.writeFile("ws-log-" + filename, JSON.stringify(json, null, 4), function(err) {
		    if(err){
		      cli.error(err);
		    }else{}
		});
	}catch(e){
		cli.error(e);
	}
};

WsHelper.cleanJson = function(toClean) {
	return toClean.replace(/\\n/g, "\\n")
		.replace(/\\'/g, "\\'")
		.replace(/\\"/g, '\\"')
		.replace(/\\&/g, "\\&")
		.replace(/\\r/g, "\\r")
		.replace(/\\t/g, "\\t")
		.replace(/\\b/g, "\\b")
		.replace(/\\f/g, "\\f");
};
var WsBowerReportBuilder = exports;
exports.constructor = function WsBowerReportBuilder(){};

var fs = require('fs');
var cli = require('cli');
var glob = require('glob');
var crypto = require('crypto');
var checksum = require('checksum');

var exec = require('child_process').exec;
var http = require('https');
var util  = require('util');
var Download = require('download');

var MissingBower = 'Problem reading Bower.json, please check the file exists and is a valid JSON';
var invalidBowerFile = 'Problem reading Bower.json, please check that you added a NAME and VERSION to the bower.json file.';
var errorReadingBowerFiles = "error reading bower dependencies bower.json file.";

WsBowerReportBuilder.run = function(){
	console.log( "WS Bower : Initializing Agent");

	var parseBowerJson = function(json){
	    var newJson = [];
	    for (i in json){
	        if(json[i].id == "download"){
	            newJson.push(json[i])
	        }
	    }
	    return newJson;
	}

	var downloadPckgs = function(){
	    //need to handle read exception 
	    console.log( "WS Bower : Locating Bower Pacakges Source...");
		var bowerJson = parseBowerJson(    JSON.parse(fs.readFileSync("./.ws_bower/ws_bower.json", 'utf8'))    );

	    var downloadsObj = new Download({mode: '755'})
		for (i in bowerJson){
				var url = bowerJson[i].message;
	            var fileType = url.split("/");
	            var depName = bowerJson[i].data.resolver.name;

	            fileType = fileType[fileType.length - 1];
	            
	            console.log(depName + "  :  "+ url);
				
	            downloadsObj.get(url,'./.ws_bower/archive/' + depName);
	            //download(url, "./.ws_bower/archive" + fileName + fileType);
		}

	    downloadsObj.run(function(err,files){
	        // console.log(err)
	        // console.log(files)

	        console.log( "WS Bower : Running CheckSum... ");
	        var depWithCheckSum = [];

	        var callback = function (err, sum) {
	            var sumClc = (typeof (sum) != "undefined") ? sum : "0";
	            sumClc = sumClc.toUpperCase();
	            console.log( "  sum: " + sumClc + "  name:" + this.name);

	            var dep = {
	                "name": this.name,
	                "artifactId": this.name,
	                "version": this.tarZip.substr(0,this.tarZip.indexOf(".tar.gz")),
	                "groupId": this.name,
	                "systemPath": null,
	                "scope": null,
	                "exclusions": [],
	                "children": [],
	                "classifier": null,
	                "sha1": sumClc
	            }

	            //console.log(dep);

	            depWithCheckSum.push(dep)
	           
	            bowerJson[this.index]["_ws"] = true;
	            
	            var checkComplete = function(){
	                var ans = true;
	                for(var i in bowerJson){
	                    if(!bowerJson[i]._ws) {
	                        ans = false;
	                        break;
	                    }
	                }
	                return ans;
	            }

	            if(checkComplete()){
	                console.log( "WS Bower : Finishing Report");
	                fs.writeFileSync("./.ws_bower/.ws-sha1-report.json", JSON.stringify(depWithCheckSum, null, 4),{});
	            }
	        }


	        for (i in bowerJson){
	                var url = bowerJson[i].message;
	                var tarZip = url.split("/");
	                var depName = bowerJson[i].data.resolver.name;
	                tarZip = tarZip[tarZip.length - 1];

	                // console.log('checksum now for ' + newLoc + "/" + compMainFile);
	                checksum.file("./.ws_bower/archive/"+depName+"/"+tarZip, callback.bind({name:depName,tarZip:tarZip,index:i}));
	        }

	    });
	};


	//spawn = require('child_process').spawn,
	var spawnSync = require('child_process').spawnSync;



	console.log( "WS Bower : Strarting Report...");
	//make temp folder for installing plugins
	exe    = spawnSync('mkdir',['.ws_bower']);
	exe    = spawnSync('mkdir',['archive'],{cwd: './.ws_bower'});

	console.log( "WS Bower : Locating Original Bower.json...");
	//copy original bower.json to install from
	exe    = spawnSync('cp',['./bower.json','./.ws_bower/']);


	//run bower install and save json (--force to avoid cache) cmd to run in ws folder.
	console.log( "WS Bower : Installing and Scanning Dependencies...");
	exe    = spawnSync('bower',['install','--json', '--force'],{cwd: './.ws_bower'});

	fs.writeFile('./.ws_bower/ws_bower.json', exe.stderr, function (err) {
	  if (err) return console.log(err);
	  console.log("WS Bower: Downloading Packages...");
	  downloadPckgs();
	});

}


WsBowerReportBuilder.buildReport = function(){
	WsBowerReportBuilder.run();
	var depsArray = [];
	var report_JSON = {};
	var bowerFile = {};

	try{
		bowerFile = JSON.parse(fs.readFileSync('./bower.json', 'utf8'));
	}catch(e){
		cli.error(MissingBower);
		return false;
	}

	try{
		report_JSON.name = bowerFile.name;
		report_JSON.version = bowerFile.version;
	}catch(e){
		cli.error(invalidBowerFile);
		return false;
	}

	//reading bower deps report
	try{
		depsArray = JSON.parse(fs.readFileSync('./ws_bower.json', 'utf8'));
	}catch(e){
		cli.error(errorReadingBowerFiles);
		return false;
	}

	return {"deps":depsArray,"report":report_JSON};
}
var express = require('express');
var router = express.Router();

var neo4j = require('neo4j-driver');
var jsforce = require('jsforce');

var moment = require('moment');

const graphenedbURL = process.env.GRAPHENEDB_BOLT_URL;
const graphenedbUser = process.env.GRAPHENEDB_BOLT_USER;
const graphenedbPass = process.env.GRAPHENEDB_BOLT_PASSWORD;

const objectFieldMap = new Map();
objectFieldMap['INDIVIDUAL'] = [];
objectFieldMap['CONTACT'] = ['IndividualId'];
objectFieldMap['EMPLOYEE'] = ['CurrentWellnessStatus', 'StatusEndDate', 'StatusAsOf', 'IndividualId'];
objectFieldMap['SERVICERESOURCE'] = ['wkfsl__Employee__c'];
objectFieldMap['SHIFT'] = ['StartTime', 'EndTime', 'ServiceResourceId', 'ServiceTerritoryId', 'Status'];
objectFieldMap['SERVICETERRITORY'] = ['ParentTerritoryId', 'TopLevelTerritoryId', 'wkfsl__Location__c', 'wkfsl__Maximum_Occupancy__c'];
objectFieldMap['LOCATION'] = ['RootLocationId'];

var driver = neo4j.driver(graphenedbURL, neo4j.auth.basic(graphenedbUser, graphenedbPass), {encrypted: 'ENCRYPTION_ON'});

var conn = new jsforce.Connection({
  loginUrl: process.env.SFDCURL,
  clientId: process.env.SFCLIENTID,
  clientSecret: process.env.SFCLIENTSECRET,
  redirectUri: process.env.SFREDIRECT,
  version: '48.0'
});
conn.login(process.env.SFDCUSERNAME, process.env.SFDCPASSWORD, (err, userInfo) => {
  if(err) return console.error(err);
  console.log(`click click click...We're in.`);
});

router.get('/triggerDataIngest', (req, res, next) => {
  //hit the api, fetch some individual data time.
  const lastQueryTime = getLastQueryTime();
  processAllTables(lastQueryTime)
  .then((result) => {
    console.log(`final ${result}`);
    res.send(200);
  })
  .catch((error)=> {
    console.error(error);
    res.send(500);
  })
});

router.get('/queries/findAllAtRiskEmployees', (req, res, next) => {
  var startTime = moment();
  whoIsAtRiskAndHow()
  .then(result => {
    console.log('left method with result');
    var deltaTime = moment().diff(startTime);
    var d = moment.utc(deltaTime).format("HH:mm:ss:SSS");
    console.log(`runtime: ${d}`);
    res.json(result);
  })
  .catch(error => {
    console.error(error);
    res.sendStatus(500);
  })
});

router.get('/queries/findEmployeeRiskVectors', (req, res, next) => {
  let employeeID = req.query.employeeID;
  var returnObject = {};
  var cypher = `MATCH (emp:EMPLOYEE {Id:'${employeeID}'})<-[:IS]-()<-[:WORKED_BY]-(empShifts:SHIFT)-[:LOCATED_AT]->(shiftTerritory:SERVICETERRITORY)<-[:LOCATED_AT]-(sickShifts:SHIFT)-[:WORKED_BY]->()-[:IS]->(sickEmps:EMPLOYEE {CurrentWellnessStatus:'Unavailable'}) `;
  cypher +=    `WHERE sickShifts.StartTime > sickEmps.StatusAsOf AND NOT (sickShifts.EndTime <= empShifts.StartTime OR sickShifts.StartTime >= empShifts.EndTime) `;
  cypher +=    `RETURN DISTINCT emp.Id as EmployeeID, empShifts.Id as EmployeeRiskShift, shiftTerritory.Id as ShiftTerritory, sickShifts.Id as SickEmployeeShift, sickEmps.Id as sickEmployeeID`;
  var session = driver.session();
  session
  .run(cypher, {})
  .then(result => {
    result.records.forEach(record => {
      let shiftID = record.get('EmployeeRiskShift');
      if(returnObject[shiftID] == undefined){
        returnObject[shiftID] = [];
      }
      let vectorObject = {
        shiftTerritoryID: record.get('ShiftTerritory'),
        sickShiftID: record.get('SickEmployeeShift'),
        sickEmployeeID: record.get('sickEmployeeID')
      }
      returnObject[shiftID].push(vectorObject);
    });
  })
  .catch(error => {
    console.error(error);
    res.send(500);
  })
  .then(() => {
    console.log('done');
    session.close();
    res.json(returnObject);
  })
});

router.get('/queries/findPotentialCasesFromSickEmployee', (req, res, next) => {
  var employeeID = req.query.employeeID;
  var riskPeriodStartDate = req.query.startDate; // should be zulu time - ISO string status, dig - 2020-06-10T17:00:24.163Z
  var cypher = `MATCH (sickEmp:EMPLOYEE {Id:'${employeeID}'})<-[:IS]-()<-[:WORKED_BY]-(sickShifts:SHIFT)-[:LOCATED_AT]->(shiftTerritory:SERVICETERRITORY)<-[:LOCATED_AT]-(empShifts:SHIFT)-[:WORKED_BY]->()-[:IS]-(otherEmployees:EMPLOYEE) `;
  cypher +=    `WHERE otherEmployees.CurrentWellnessStatus <> "Unavailable" AND NOT (empShifts.EndTime <= sickShifts.StartTime OR empShifts.StartTime >= sickShifts.EndTime) `
  cypher +=    `AND sickShifts.StartTime >= '${riskPeriodStartDate}' `;
  cypher +=    `RETURN sickShifts.Id AS SickEmpShiftId, shiftTerritory.Id as ShiftTerritoryId, empShifts.Id AS AffectedEmployeeShiftId, otherEmployees.Id AS AffectedEmployeeId`;
  var returnObject = {};
  var session = driver.session();
  session
  .run(cypher, {})
  .then(result => {
    result.records.forEach(record => {
      let affectedEmployeeId = record.get('AffectedEmployeeId');
      if(returnObject[affectedEmployeeId] == undefined){
        returnObject[affectedEmployeeId] = [];
      }
      let vectorObject = {
        shiftId:record.get('AffectedEmployeeShiftId'),
        territoryId: record.get('ShiftTerritoryId'),
        sickEmpShiftId: record.get('SickEmpShiftId')
      }
      returnObject[affectedEmployeeId].push(vectorObject);
    });
  })
  .catch(error => {
    console.error(error);
  })
  .then(() => {
    console.log('done');
    session.close();
    res.json(returnObject);
  })
});


var getAllRiskyShifts = function(){
  //Find all shifts worked by sick employees SINCE they got sick.
  return new Promise((resolve, reject) => {
    var cypher = `MATCH (e:EMPLOYEE {CurrentWellnessStatus: "Unavailable"})<-[:IS]-()<-[:WORKED_BY]-(sh:SHIFT) `;
    cypher +=    `WHERE e.StatusAsOf < sh.StartTime RETURN e.Id AS EmployeeID, sh.Id AS ShiftID`;
    var returnMapByEmployee = new Map();
    var session = driver.session();
    session
    .run(cypher, {})
    .then(result => {
      result.records.forEach(record => {
        if(returnMapByEmployee.get(record.get('EmployeeID'))){
          returnMapByEmployee.set(record.get('EmployeeID'), []);
        }
        let vectorObject = {
          riskyShiftID: record.get('ShiftID'),
          employeeID: record.get('EmployeeID')
        }
        returnMapByEmployee.get(record.get('EmployeeID')).push(vectorObject);
        console.log(`New risky shift found for ${record.get('EmployeeID')}`);
      });
    })
    .catch(error => {
      reject(Error(error));
    })
    .then(()=>{
      session.close();
      resolve(returnMapByEmployee);
    });
  });
}

var whoIsAtRiskAndHow = function(){
  return new Promise((resolve, reject) => {
    /* Original without identifying shift was a danger
    var cypher = `MATCH (e:EMPLOYEE)<-[:IS]-(:SERVICERESOURCE)<-[:WORKED_BY]-(others:SHIFT)-[:LOCATED_AT]->(terr:SERVICETERRITORY)<-[:LOCATED_AT]-(sh:SHIFT)-[:WORKED_BY]->(:SERVICERESOURCE)-[:IS]->(sick:EMPLOYEE {CurrentWellnessStatus:"Unavailable"}) `;
    cypher +=    `WHERE NOT e.CurrentWellnessStatus = 'Unavailable' `;
    cypher +=    `WITH others, sh, terr, e, sick `;
    cypher +=    `WHERE (e.CurrentWellnessStatus <> "Unavailable") AND NOT (others.EndTime<=sh.StartTime OR others.StartTime>=sh.EndTime) `;
    cypher +=    `RETURN DISTINCT  e.Id as EmployeeIDAtRisk, others.Id as exposureShift, terr.Id as exposureTerritory, sick.Id as sickEmployee, sh.Id as sickEmployeeShift `;
    */
   var cypher = `MATCH (e:EMPLOYEE {CurrentWellnessStatus: "Unavailable"})<-[:IS]-()<-[:WORKED_BY]-(sh:SHIFT) WHERE e.StatusAsOf < sh.StartTime `;
   cypher += `WITH sh, e MATCH (sh)-[:LOCATED_AT]->(terr:SERVICETERRITORY)<-[:LOCATED_AT]-(impactedShifts:SHIFT)-[:WORKED_BY]->()-[:IS]->(atRisk:EMPLOYEE) `;
   cypher += `WHERE (atRisk.CurrentWellnessStatus <> "Unavailable") AND NOT (impactedShifts.EndTime<=sh.StartTime OR impactedShifts.StartTime>=sh.EndTime) AND impactedShifts.StartTime > atRisk.StatusAsOf `;
   cypher += `RETURN DISTINCT e.Id AS sickEmployee, sh.Id AS sickEmployeeShift,terr.Id as exposureTerritory, atRisk.Id AS EmployeeIDAtRisk, impactedShifts.Id AS exposureShift`;
    var returnObject = {};
    var session = driver.session();
    session
    .run(cypher, {})
    .then(result => {
      result.records.forEach(record => {
        let empIDAtRisk = record.get('EmployeeIDAtRisk');
        if(returnObject[empIDAtRisk] == undefined){
          returnObject[empIDAtRisk] = [];
        }
        let vectorObject = {
          exposureShiftID: record.get('exposureShift'),
          exposureTerritoryID: record.get('exposureTerritory'),
          sickEmployeeShiftID: record.get('sickEmployeeShift'),
          sickEmployeeID: record.get('sickEmployee')
        }
        returnObject[empIDAtRisk].push(vectorObject);
        console.log(`New Vector Found For ${empIDAtRisk}`);
        //This will let us validate the info is inserted into the actual array. God it's verbose though oof.
        //console.log(returnMapByEmployee.get(record.get('EmployeeIDAtRisk'))[returnMapByEmployee.get(record.get('EmployeeIDAtRisk')).length-1]);
      });
    })
    .catch(error => {
      reject(Error(error));
    })
    .then(() => {
      session.close();
      resolve(returnObject);
    })
  });
}

var getAllDistinctNonPositiveEmployeesWhoWorkedShiftNearPositiveEmployees = function(){
  return new Promise((resolve, reject) => {
    var cypher = `MATCH (e:EMPLOYEE)<-[:IS]-(:SERVICERESOURCE)<-[:WORKED_BY]-(others:SHIFT)-[:LOCATED_AT]->(terr:SERVICETERRITORY)<-[:LOCATED_AT]-(sh:SHIFT) `;
    cypher +=    `WHERE (sh)-[:WORKED_BY]->(:SERVICERESOURCE)-[:IS]->(:EMPLOYEE {CurrentWellnessStatus:"Unavailable"}) `;
    cypher +=    `AND NOT e.CurrentWellnessStatus = 'Unavailable' `;
    cypher +=    `WITH others, sh, terr, e `;
    cypher +=    `WHERE NOT (others.EndTime<=sh.StartTime OR others.StartTime>=sh.EndTime) `;
    cypher +=    `RETURN DISTINCT e.Id as EmployeeIDAtRisk`;
    var idList = [];
    var session = driver.session();
    session
    .run(cypher, {})
    .then(result => {
      result.records.forEach(record => {
        //console.log(record.get('EmployeeIDAtRisk'));
        idList.push(record.get('EmployeeIDAtRisk'));
      });
    })
    .catch(error => {
      reject(Error(error));
    })
    .then(() => {
      session.close();
      resolve(idList);
    })
  });
}

var processAllTables = function(lastQueryTime){
  return new Promise((resolve, reject) => {
    handleTable(lastQueryTime, 'INDIVIDUAL')
    .then((result) => {
      return handleTable(lastQueryTime, 'CONTACT');
    })
    .then((result) => {
      return handleTable(lastQueryTime, 'EMPLOYEE');
    })
    .then((result) => {
      return handleTable(lastQueryTime, 'SERVICERESOURCE');
    })
    .then((result) => {
      return handleTable(lastQueryTime, 'SHIFT');
    })
    .then((result) => {
      return handleTable(lastQueryTime, 'SERVICETERRITORY');
    })
    .then((result) => {
      return handleTable(lastQueryTime, 'LOCATION');
    })
    .then((result) => {
      console.log('All tables inserted. Time to move on to restitching relationships.');
      return handleAllRelationships();
      //match (e:EMPLOYEE), (i:INDIVIDUAL) WHERE i.Id = e.IndividualId create (e)-[x:IS]->(i) return x
      //match (c:CONTACT), (i:INDIVIDUAL) WHERE i.Id = c.IndividualId CREATE (c)-[x:IS]->(i) RETURN x
      //MATCH (sr:SERVICERESOURCE), (e:EMPLOYEE) WHERE sr.wkfsl__Employee__c = e.Id CREATE (sr)-[x:IS]->(e) RETURN x;
      //MATCH (sh:SHIFT), (sr:SERVICERESOURCE) WHERE sh.ServiceResourceId = sr.Id CREATE (sh)-[w:WORKED_BY]->(sr) RETURN w
      //MATCH (st:SERVICETERRITORY), (sh:SHIFT) WHERE sh.ServiceTerritoryId = st.Id CREATE (sh)-[l:LOCATED_AT]->(st) RETURN l
      //MATCH (child:SERVICETERRITORY), (parent:SERVICETERRITORY) WHERE child.ParentTerritoryId = parent.Id CREATE (child)-[p:PART_OF]->(parent) return p
      //MATCH (child:SERVICETERRITORY), (topLevel:SERVICETERRITORY) WHERE child.TopLevelTerritoryId = topLevel.Id CREATE (child)-[tl:TOP_LEVEL]->(topLevel) return tl
      //MATCH (st:SERVICETERRITORY), (l:LOCATION) WHERE st.wkfsl__Location__c = l.Id CREATE (st)-[x:LOCATED_IN]->(l) return x
    })
    .then((result) => {
      console.log(`processTables result ${result}`);
      resolve(result);
    })
     .catch((error) => {
       reject(Error(error));
     });
  });
}

var handleAllRelationships = function() {
  return new Promise((resolve, reject) => {
    handleRelationship('EMPLOYEE', 'IndividualId', 'IS', 'INDIVIDUAL', 'Id')
    .then((result) => {
      return handleRelationship('CONTACT', 'IndividualId', 'IS', 'INDIVIDUAL', 'Id');
    })
    .then((result) => {
      return handleRelationship('SERVICERESOURCE', 'wkfsl__Employee__c', 'IS', 'EMPLOYEE', 'Id');
    })
    .then((result)=> {
      return handleRelationship('SHIFT', 'ServiceResourceId', 'WORKED_BY', 'SERVICERESOURCE', 'Id');
    })
    .then((result) => {
      return handleRelationship('SHIFT', 'ServiceTerritoryId', 'LOCATED_AT', 'SERVICETERRITORY', 'Id');
    })
    .then((result) => {
      return handleRelationship('SERVICETERRITORY', 'ParentTerritoryId', 'PART_OF', 'SERVICETERRITORY', 'Id');
    })
    .then((result) => {
      return handleRelationship('SERVICETERRITORY', 'TopLevelTerritoryId', 'PART_OF', 'SERVICETERRITORY', 'Id');
    })
    .then((result) => {
      return handleRelationship('SERVICETERRITORY', 'wkfsl__Location__c', 'LOCATED_IN', 'LOCATION', 'Id');
    })
    .then((result) => {
      resolve(result);
    })
    .catch((error) => {
      reject(Error(error));
    });
  });
}

var handleRelationship = function(baseNode, foreignKeyParameter, relationshipName, targetNode, primaryKeyParameter){
  return new Promise((resolve, reject) => {
    //match (e:EMPLOYEE), (i:INDIVIDUAL) WHERE i.Id = e.IndividualId create (e)-[x:IS]->(i) return x
    //MATCH (b:$baseNodeVar), (t:$targetNodeVar) WHERE t.$primaryKeyParameterVar = b.$foreignKeyParameterVar CREATE (b)-[r:$relationshipNameVar]->(t) return r;
    var cypher = `MATCH (b:${baseNode}), (t:${targetNode}) WHERE t.${primaryKeyParameter} = b.${foreignKeyParameter} CREATE (b)-[r:${relationshipName}]->(t) return r;`;
    var session = driver.session();
    session
    .run(cypher, {})
    .then(result =>{
      console.log(`Set up (${baseNode})-[${relationshipName}]->(${targetNode})`);
      session.close();
      resolve(result);
    })
    .catch(error => {
      reject(Error(error));
    })
  });
}

var handleTable = function(lastQueryTime, objectName){
  fieldList = objectFieldMap[objectName];
  return new Promise((resolve, reject) => {
    performSFDCQuery(lastQueryTime, objectName, fieldList)
    .then((result) => {
      return performGraphMerge(result, objectName, fieldList);
    })
    .then((result) => {
      resolve(result);
    })
    .catch((error) => {
      reject(Error(error));
    })
  })
}

var performSFDCQuery = function(lastQueryTime, objectName, fieldList){
  return new Promise((resolve, reject) => {
    var records =[];
    conn.sobject(objectName)
    .find({}, ['Id', ...fieldList])
    .then((result) => {
      //console.log(result.records);
      records = [...result];
    })
    .then((ret) => {
      resolve(records);
    }, (err) => {
      reject(Error(err));
    });
  });
}

var performGraphMerge = function(records, objectName, fieldList){
  return new Promise((resolve, reject) => {
        var cypherFieldSetString = '';
    fieldList.forEach(field => {
      cypherFieldSetString+= ` r.${field} = record.${field},`;
    });
    cypherFieldSetString = cypherFieldSetString.substring(0, cypherFieldSetString.length-1);
    
    var cypher = `UNWIND $recordsVar AS record `
    cypher +=    `MERGE (r:${objectName} {Id:record.Id}) `;
    if(fieldList.length>0){
      cypher +=  `ON CREATE SET ${cypherFieldSetString} `;
      cypher +=  `ON MATCH SET ${cypherFieldSetString} `;
    }
    cypher +=    `RETURN r.Id AS ID`;

    var session = driver.session();
    session
    .run(cypher, {
      recordsVar: records
    })
    .then(result => {
      console.log(`merge function result: ${result}`);
      session.close();
      resolve(result);
    })
    .catch(error => {
      reject(Error(error));
    })
  });
}

function getLastQueryTime(){
  var session = driver.session();
  let runTime;
  session
    .run("MATCH (lm:LASTMOD) RETURN lm.lastRun AS lastRun")
    .subscribe({
      onNext: function(record){
        console.log(record.get('lastRun').toString());
        runTime = record.get('lastRun').toString();
      },
      onCompleted: function(){
        session.close();
        return runTime;
      },
      onError: function(error){
        console.log(error);
      }
    });
}

function updateLastQueryTime(){

}


/* GET home page. */
router.get('/', function(req, res, next) {

  res.render('index', { title: 'Express' });
});


module.exports = router;
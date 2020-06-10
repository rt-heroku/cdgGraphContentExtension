# WDC Shift Management Contact Graph Extension _(wdcGraphContactExtension)_


[![Salesforce API v48.0](https://img.shields.io/badge/Salesforce%20API-v48.0-blue.svg)]()

[![Lightning Experience Required](https://img.shields.io/badge/Lightning%20Experience-Required-informational.svg)]()

[![User License Platform](https://img.shields.io/badge/User%20License-Platform-032e61.svg)]()


> Extending WDC to do more complicated relationship queries using Neo4j from Graphene and Heroku.

This tool will automatically ingest 'safe' data from the WDC shift management module out of your SFDC org and stitch it together as a related set of nodes. Then it exposes 3 query APIs to get a JSON return of IDs for the usecases each has, which you'd use to make your SFDC queries to pull in context for the IDs returned. This doesn't have the SFDC side.

## Security and Limitations (see note)
There's no touch on the Salesforce side of the coin from a limits standpoint. Really a handful of simple API requests which even at scale wouldn't destroy the world. 

On Security, the runtime is common, and the Neo4j backend is owned/operated by Graphene. It uses encryption, but you'd have to vette the provider of your DB around security/residency/etc concerns. I will say that you're ONLY extracting SFID's and certain filter points, no PII (aside from MAYBE test date could be arguable depending on company size). Fully tokenized.

## Background

Gimmie yer life story here. Motivation, dependencies that might be unclear, what this thing is and what you're trying to accomplish. 

## Install

First, get you that WDC Salesforce org. If you don't, you're gonna have a bad time.

Get into your Org and create a Connected App, and give it 5-10 to push out the details to all the servers. 

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/cowie/wdcGraphContactExtension)
Run the button. Fill out config variables as the following
* SFDCUSERNAME : Org's username. Needs read access to Shift, Employee, Individual, Contact, ServiceTerritory, ServiceResource objects.
* SFDCPASSWORD : Your user password, with Dev Token appended.
* SFCLIENTID : OAuth Client ID from the Connected App you made.
* SFCLIENTSECRET : OAuth Client Secret from the Connected App you made.
* SFDCURL : Probably https://login.salesforce.com, https://test.salesforce.com, or https://mydomain.my.salesforce.com.
* SFREDIRECT : The redirect URL you threw in your connected app. Anything's clever here.

Let the server build - and again, give it a bit of time. Graphene takes a solid few minutes to provision and push the Graph database.

Note: Because I don't wanna cost you change, this Button uses the Free (Dev) tier of Graphene. This version sleeps on Idle, and has a 1000 node limit and 10000 relationship limit. That means you can use it - but it'll be SUPER limited on data size to test. I did most of my work on the Dev Basic tier at 9/mo, which is basically a 100x increase. Figured it was worth the cost but you do you.

### Dependencies
* Salesforce org with WDC + Shift Management INSTALLED

## Usage

#### /triggerDataIngest()
**Returns**
* Type *JSON String*

Hit this endpoint when your Graph DB is up and running and you want to populate it with everything in the assigned Salesforce org. It will try to wait out the work and get back to you but honestly it'll probably take more than 30 seconds to pull everything and you'll time out on Heroku. I recommend you look at the heroku logs in order to identify when the work's complete.

#### /queries/findAllAtRiskEmployees()
**Returns**
* Type *JSON String*
```
{
    ${At Risk Employee ID}: [
        {
            exposureShiftID : Shift by At Risk employee with overlap to Sick employee shift.
            exposureTerritoryID : Territory the shifts took place at,
            sickEmployeeShiftId : Shift by Sick employee with overlap to At Risk employee shift.,
            sickEmployeeID : Employee who is sick
        }
    ], 
    ...
}
```

Alright, the biggun. Lotta steps to this, yet only a 2-part query in Graph. First, we get all EMPLOYEEs who are marked as Unavailable, and find all SHIFTs they have worked *after* their marked StatusAsOf date. Basically, everything they worked after they were confirmed as sick. We then take that and find all SHIFTs worked by all *available* employees which have a time overlap as well as a TERRITORY overlap. The resulting list provides us all Employees who have reliably been in the same general area as a sick employee after the time we confirmed they were sick, and the path back including the shifts that overlap as well as the territory and the sick employee.

#### /queries/findEmployeeRiskVectors(employeeID)
**URL Query Params**
* employeeID, *string* :18 digit SFID for the employee you want to check
**Returns**
* Type *JSON String*
```
{
    ${Employee Shift ID}: [
        {
            shiftTerritoryID: Territory linked to both shifts,
            sickShiftID: Shift worked by Sick employee that overlaps with At Risk Employee,
            sickEmployeeID: Sick Employee
        }
    ], 
    ...
}
```

These become more pointed filters of the big return. This one accepts an EmployeeID to find all shifts that fit the model mentioned in the report above. What shifts has this particular employee worked with a time and location overlap with any sick Employees after the date they were confirmed sick. This will give you a particular person's general threat analysis by showing what work vectors impact them. List returns all the shifts they worked that are 'at risk', along with territory, overlapping shift, and sick person.


#### /queries/findPotentialCasesFromSickEmployee(employeeID, startDate)
**URL Query Params**
* employeeID, *string* :18 digit SFID for the employee you want to check
* startDate, *string* :Zulu datetime string for the date to test from
* **Returns**
* Type *JSON String*
```
{
    ${At Risk Employee ID}: [
        {
            shiftId: Shift worked by At Risk employee with overlap to Queried employee,
            territoryId: Territory shifts occurred at,
            sickEmpShiftId: Shift worked by Queried employee with overlap to At Risk employee.
        }
    ], 
    ...
}
```

Another way to look at similar data, this is what you run if someone suddenly turns sick and you need a basis to start tracing backwards. From a given employeeID, what non-sick employees have they worked with since an arbitrary date. The purpose of this is more if you have to do batch operations daily/nightly to update the graph, but need an immediate call-down list when someone goes positive.


## Extra Sections
## Thanks
<!--Don't be a jerk thank those who helped you-->
As always I stole the readme format from - [!Richard Litt(https://github.com/RichardLitt/standard-readme/blob/master/spec.md)]'s standard-readme doc. Ideas about doing this from Shawn (Butters) Butterfield and Abigail Knox, along with Abhishek Chaturvedi for caring about Graph.

## Contributing
<!--Give instructions on how to contribute to this repository. Where do I ask questions? Do you accept PRs? What are the requirements to contribute? Don't be a jerk. Use issues if you can.-->
Dig it? Hit me up, let's jam. Or just go fork it and have fun.

## License
<!-- Actually required. State the owner, -->
[MIT](LICENSE) © CDG

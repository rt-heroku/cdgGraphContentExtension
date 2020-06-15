// Demo Neo4j database settings hosted on GrapheneDb
popoto.rest.CYPHER_URL = "https://db-kh9ct9ai1mqn6hz2itry.graphenedb.com:24780/db/data/transaction/commit";
popoto.rest.AUTHORIZATION = "Basic cG9wb3RvOmIuVlJZQVF2blZjV2tyLlRaYnpmTks5aHp6SHlTdXk=";

// Define the list of label provider to customize the graph behavior:
// Only two labels are used in Neo4j movie graph example: "Movie" and "Person"
popoto.provider.node.Provider = {
    "Movie": {
        "returnAttributes": ["title", "released", "tagline"],
        "constraintAttribute": "title"
    },
    "Person": {
        "returnAttributes": ["name", "born"],
        "constraintAttribute": "name"
    }
};

// Start the generation using parameter as root label of the query.
popoto.start("Person");
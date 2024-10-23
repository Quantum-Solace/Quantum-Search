const express = require('express');
const fs = require('fs');
const path = require('path');
const csvParser = require('csv-parser');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const dataFolder = path.join(__dirname, 'data');

// Set up view engine and middleware
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Helper function to check if a line matches search criteria based on priority
function matchesSearchCriteria(lineData, searchCriteria) {
    const orderOfSearch = ['email', 'username', 'phoneNumber', 'firstName', 'lastName', 'fullName', 'address', 'country', 'state'];

    // Build the full name for comparison
    const fullName = `${searchCriteria.firstName} ${searchCriteria.lastName}`.trim().toLowerCase();

    // Check each field in the given priority order
    for (const field of orderOfSearch) {
        if (field === 'fullName' && fullName) {
            // Special case for full name
            if (lineData.some(fieldData => fieldData.includes(fullName))) {
                return true;
            }
        } else if (searchCriteria[field]) {
            // Check other fields like email, username, etc.
            if (lineData.some(fieldData => fieldData.includes(searchCriteria[field]))) {
                return true;
            }
        }
    }
    return false;
}

// Function to search for images related to the search terms
function findRelatedImages(searchCriteria) {
    const images = [];
    const imageExtensions = ['.jpg', '.png'];

    fs.readdirSync(dataFolder).forEach(file => {
        const ext = path.extname(file).toLowerCase();
        // Check if the file is an image
        if (imageExtensions.includes(ext)) {
            // Check if the image filename contains any of the search criteria
            const fileName = path.basename(file, ext).toLowerCase();
            const { email, username, phoneNumber, firstName, lastName, address, country, state } = searchCriteria;

            if ([email, username, phoneNumber, firstName, lastName, address, country, state].some(term => term && fileName.includes(term))) {
                images.push(file);
            }
        }
    });

    return images;
}

// Route for rendering the search page
app.get('/', (req, res) => {
    res.render('index', { results: [], images: [] });
});

// Route to handle search functionality
app.post('/search', async (req, res) => {
    const searchCriteria = {
        firstName: req.body.firstName ? req.body.firstName.toLowerCase() : '',
        lastName: req.body.lastName ? req.body.lastName.toLowerCase() : '',
        email: req.body.email ? req.body.email.toLowerCase() : '',
        phoneNumber: req.body.phoneNumber ? req.body.phoneNumber.toLowerCase() : '',
        address: req.body.address ? req.body.address.toLowerCase() : '',
        country: req.body.country ? req.body.country.toLowerCase() : '',
        state: req.body.state ? req.body.state.toLowerCase() : '',
        username: req.body.username ? req.body.username.toLowerCase() : ''
    };

    const results = [];
    const images = findRelatedImages(searchCriteria); // Get related images

    // Get all files in the /data/ folder
    fs.readdir(dataFolder, (err, files) => {
        if (err) {
            console.error('Error reading data folder:', err);
            res.render('index', { results, images });
            return;
        }

        // Process each file in the folder
        files.forEach(file => {
            const filePath = path.join(dataFolder, file);
            const ext = path.extname(file).toLowerCase();

            if (ext === '.txt') {
                // Search in .txt files
                fs.readFile(filePath, 'utf8', (err, data) => {
                    if (err) throw err;
                    const txtLines = data.split('\n');
                    txtLines.forEach(line => {
                        const lineData = line.split(/[\s,]+/).map(item => item.toLowerCase());
                        if (matchesSearchCriteria(lineData, searchCriteria)) {
                            results.push({ source: file, data: line });
                        }
                    });
                });
            }

            if (ext === '.csv') {
                // Search in .csv files
                const csvResults = [];
                fs.createReadStream(filePath)
                    .pipe(csvParser())
                    .on('data', (row) => {
                        if (matchesSearchCriteria(Object.values(row).map(item => item.toLowerCase()), searchCriteria)) {
                            csvResults.push({ source: file, data: row });
                        }
                    })
                    .on('end', () => {
                        results.push(...csvResults);
                    });
            }

            if (ext === '.db' || ext === '.sqlite') {
                // Search in SQLite databases
                const db = new sqlite3.Database(filePath);
                db.all(`SELECT * FROM people WHERE LOWER(email) LIKE '%${searchCriteria.email}%' 
                        OR LOWER(username) LIKE '%${searchCriteria.username}%' 
                        OR LOWER(phone) LIKE '%${searchCriteria.phoneNumber}%' 
                        OR LOWER(first_name) LIKE '%${searchCriteria.firstName}%' 
                        OR LOWER(last_name) LIKE '%${searchCriteria.lastName}%' 
                        OR LOWER(address) LIKE '%${searchCriteria.address}%' 
                        OR LOWER(country) LIKE '%${searchCriteria.country}%' 
                        OR LOWER(state) LIKE '%${searchCriteria.state}%'`, [], (err, rows) => {
                    if (err) throw err;
                    rows.forEach((row) => {
                        results.push({ source: file, data: row });
                    });
                    db.close();
                });
            }

            if (ext === '.json') {
                // Search in JSON files
                fs.readFile(filePath, 'utf8', (err, data) => {
                    if (err) throw err;
                    let jsonData;
                    try {
                        jsonData = JSON.parse(data);
                    } catch (parseErr) {
                        console.error(`Error parsing JSON from file ${file}:`, parseErr);
                        return;
                    }
                    // Assuming jsonData is an array of objects
                    if (Array.isArray(jsonData)) {
                        jsonData.forEach((item) => {
                            // Ensure we map only string values
                            const itemData = Object.values(item).map(val => (typeof val === 'string' ? val.toLowerCase() : val));
                            if (matchesSearchCriteria(itemData, searchCriteria)) {
                                results.push({ source: file, data: item });
                            }
                        });
                    } else {
                        console.warn(`JSON data from file ${file} is not an array.`);
                    }
                });
            }

            if (ext === '.jsonl') {
                // Search in JSON Lines files
                fs.readFile(filePath, 'utf8', (err, data) => {
                    if (err) throw err;
                    const jsonLines = data.split('\n');
                    jsonLines.forEach((line) => {
                        if (line.trim()) { // Check if line is not empty
                            let jsonData;
                            try {
                                jsonData = JSON.parse(line);
                            } catch (parseErr) {
                                console.error(`Error parsing JSON line from file ${file}:`, parseErr);
                                return;
                            }
                            // Ensure we map only string values
                            const itemData = Object.values(jsonData).map(val => (typeof val === 'string' ? val.toLowerCase() : val));
                            if (matchesSearchCriteria(itemData, searchCriteria)) {
                                results.push({ source: file, data: jsonData });
                            }
                        }
                    });
                });
            }
        });

        // Wait for all files to be processed and then render the results
        setTimeout(() => {
            res.render('index', { results, images });
        }, 1000); // Adjust timeout to ensure all async file reads complete
    });
});

// Start the server
const port = 3000;
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

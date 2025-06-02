// song-guesser-api/scripts/import_charts_to_db.js

const fs = require('fs').promises; // Use promises API for fs
const path = require('path');
const { parse } = require('csv-parse'); // From 'csv' package
const { getDb, dbInitializationPromise } = require('../services/database-service'); // Adjust path if script is elsewhere

// --- Configuration ---
// Adjust this path to where your Python script saves the 'csvs' folder,
// relative to THIS import_charts_to_db.js script.
// If this script is in song-guesser-api/scripts/ and Python script (and its csvs folder)
// is in song-guesser-scripts/ (a sibling to song-guesser-api/), then:
const csvDirectory = path.join(__dirname, '../../song-guesser-scripts/csvs');
// --- End Configuration ---


async function processCsvFile(filePath, db) {
    console.log(`\nProcessing CSV file: ${path.basename(filePath)}...`);
    const fileContent = await fs.readFile(filePath, { encoding: 'utf8' });
    
    return new Promise((resolve, reject) => {
        parse(fileContent, {
            columns: true, // Use the first row as column headers
            skip_empty_lines: true,
            trim: true
        }, async (err, records) => {
            if (err) {
                console.error(`Error parsing CSV ${filePath}:`, err);
                return reject(err);
            }

            let newSongsInserted = 0;
            let songsChecked = 0;
            let songsSkipped = 0;

            for (const record of records) {
                songsChecked++;
                const title = record.Track_Title; // Matches CSV header from Python script
                const artist = record.Artist_Name; // Matches CSV header
                const year = parseInt(record.Year, 10); // Matches CSV header

                if (!title || !artist || isNaN(year)) {
                    console.warn(`Skipping invalid record in ${path.basename(filePath)}:`, record);
                    songsSkipped++;
                    continue;
                }

                try {
                    // Check if song already exists (by title, artist, year for this initial import)
                    const existingSong = await new Promise((resolveCheck, rejectCheck) => {
                        db.get(
                            'SELECT id FROM curated_songs WHERE title = ? AND artist = ? AND year = ?',
                            [title, artist, year],
                            (checkErr, row) => {
                                if (checkErr) return rejectCheck(checkErr);
                                resolveCheck(row);
                            }
                        );
                    });

                    if (existingSong) {
                        // console.log(`Song already exists, skipping: "${title}" by ${artist} (${year})`);
                        songsSkipped++;
                        continue;
                    }

                    // Insert new song
                    await new Promise((resolveInsert, rejectInsert) => {
                        db.run(
                            'INSERT INTO curated_songs (title, artist, year) VALUES (?, ?, ?)',
                            [title, artist, year],
                            function (insertErr) { // Use function for this.lastID
                                if (insertErr) return rejectInsert(insertErr);
                                // console.log(`Inserted: "${title}" by ${artist} (${year}), ID: ${this.lastID}`);
                                newSongsInserted++;
                                resolveInsert(this.lastID);
                            }
                        );
                    });
                } catch (dbError) {
                    console.error(`Database error for record in ${path.basename(filePath)}:`, record, dbError);
                    songsSkipped++; // Consider it skipped due to error
                }
            }
            console.log(`Finished processing ${path.basename(filePath)}: ${newSongsInserted} new songs inserted, ${songsSkipped} skipped (duplicates/invalid/errors), ${songsChecked} total records checked.`);
            resolve({ newSongsInserted, songsSkipped });
        });
    });
}

async function importAllCsvs() {
    console.log('Waiting for database initialization...');
    await dbInitializationPromise; // Ensure DB is ready
    const db = getDb();
    console.log('Database initialized.');

    let totalNewSongsInserted = 0;
    let totalSongsSkipped = 0;
    let filesProcessed = 0;

    try {
        console.log(`Reading CSV files from directory: ${csvDirectory}`);
        const files = await fs.readdir(csvDirectory);
        const csvFiles = files.filter(file => path.extname(file).toLowerCase() === '.csv' && file.startsWith('billboard_hot100_'));

        if (csvFiles.length === 0) {
            console.log('No CSV files found in the directory to import.');
            return;
        }
        console.log(`Found ${csvFiles.length} CSV files to process.`);

        for (const file of csvFiles) {
            const filePath = path.join(csvDirectory, file);
            try {
                const result = await processCsvFile(filePath, db);
                totalNewSongsInserted += result.newSongsInserted;
                totalSongsSkipped += result.songsSkipped; // Assuming processCsvFile returns this
                filesProcessed++;
            } catch (fileProcessError) {
                console.error(`Failed to process file ${file}:`, fileProcessError);
            }
        }

        console.log(`\n--- Import Complete ---`);
        console.log(`Files processed: ${filesProcessed}`);
        console.log(`Total new songs inserted into curated_songs: ${totalNewSongsInserted}`);
        console.log(`Total songs skipped (duplicates/invalid/errors): ${totalSongsSkipped}`);

    } catch (err) {
        console.error('Error reading CSV directory or processing files:', err);
    } finally {
        // db.close(); // Closing the global DB instance here might be problematic if other parts of app use it.
        // Typically, scripts like this run, and then the main app starts, or DB connection is managed per operation.
        // For a standalone script, you might close if you opened a specific connection.
        // Since getDb() returns a shared instance, avoid closing it here.
        console.log("Import script finished.");
    }
}

// Run the import process
importAllCsvs().catch(err => {
    console.error("Unhandled error in importAllCsvs:", err);
});
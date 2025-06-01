import requests
from bs4 import BeautifulSoup
import os
import csv # For writing CSV files
import time # For adding a polite delay between requests

def get_billboard_song_titles_for_year(year):
    """
    Scrapes Wikipedia for billboard song titles for a given year.
    :return: List of billboard songs and artists in a tuple '(year, rank, song, artist)'
    """
    print(f"Fetching Billboard Hot 100 for {year} from Wikipedia...")
    billboard_page = "https://en.wikipedia.org/wiki/Billboard_Year-End_Hot_100_singles_of_"
    try:
        # Add a User-Agent to be more polite to Wikipedia
        headers = {
            'User-Agent': 'SonicGuessrDataCollector/1.0 (contact@example.com; Your project link or contact info)'
        }
        page = requests.get(billboard_page + str(year), headers=headers)
        page.raise_for_status() 
    except requests.exceptions.RequestException as e:
        print(f"Error fetching page for year {year}: {e}")
        return []

    soup = BeautifulSoup(page.content, 'html.parser')
    doc = soup.find("table", {"class": ["wikitable", "sortable", "wikitable sortable"]})

    if not doc:
        print(f"Could not find the wikitable for year {year}. The page structure might have changed.")
        return []

    year_data = []
    rows_processed = 0
    errors_in_row_processing = 0

    for row_index, row in enumerate(doc.find_all(["tr"])):
        if row_index == 0: 
            header_cells = row.find_all(["th", "td"])
            if all(cell.name == 'th' for cell in header_cells) or not any(cell.name == 'td' for cell in header_cells):
                # print("Skipping potential header row:", [cell.text.strip() for cell in header_cells])
                continue
        
        cells = row.find_all(["td", "th"])
        # Remove quotes and excessive whitespace from each cell immediately
        row_data = [" ".join(cell.text.strip().replace('"', '').split()) for cell in cells]


        if len(row_data) == 3: # Rank, Title, Artist
            rank = row_data[0]
            track = row_data[1]
            artist = row_data[2]
            # Ensure track and artist are not empty after stripping
            if track and artist:
                year_data.append((str(year), rank, track, artist))
                rows_processed += 1
            else:
                print(f"Skipping row with empty track/artist after strip: {row_data} for year {year}")
        elif len(row_data) == 2: 
            rank = str(rows_processed + 1) 
            track = row_data[0]
            artist = row_data[1]
            if track and artist:
                year_data.append((str(year), rank, track, artist))
                rows_processed += 1
            else:
                print(f"Skipping row with empty track/artist after strip (2-col): {row_data} for year {year}")
        elif len(row_data) > 0 : 
            if not all(s.isspace() or not s for s in row_data): # Don't log if it's just empty/whitespace cells
                 print(f"Error Processing Row (unexpected number of columns {len(row_data)} or bad data): {row_data} for year {year}")
                 errors_in_row_processing += 1
    
    if errors_in_row_processing > 0:
        print(f"Finished processing for year {year} with {errors_in_row_processing} row processing errors (out of {rows_processed + errors_in_row_processing} total rows).")
    if rows_processed > 0:
        print(f"Successfully processed {rows_processed} valid songs for year {year}.")
    elif errors_in_row_processing == 0: # No rows processed and no errors usually means table format changed or empty
        print(f"No valid song rows found for year {year}. Check table structure on Wikipedia.")
    return year_data

def parse_artist(artist_text):
    # ... (your existing parse_artist function - kept as is from your provided version) ...
    lower_artist_text = artist_text.lower()
    split_index = len(artist_text)
    separators = [
        " featuring ", " feat. ", " feat ", 
        " with ", 
        " and ", 
        " & ", 
        " vs. ", " vs ",
        " presents ",
        " / ", 
        " x ", 
        " duet with "
    ]
    for sep in separators:
        idx = lower_artist_text.find(sep)
        if idx != -1:
            split_index = min(split_index, idx)
    
    parsed_artist = artist_text[:split_index].strip()
    if parsed_artist.lower() == "various artists":
        return "" 
    return parsed_artist


def parse_song(song_title):
    # ... (your existing parse_song function - kept as is from your provided version) ...
    parsed_title = song_title
    title_truncate_separators = [" (", "[", " /", " - "] 
    
    split_index = len(parsed_title)
    for sep in title_truncate_separators:
        idx = parsed_title.find(sep)
        if idx != -1:
            split_index = min(split_index, idx)
            
    parsed_title = parsed_title[:split_index].strip()

    if parsed_title.startswith('"') and parsed_title.endswith('"'):
        parsed_title = parsed_title[1:-1]
        
    return parsed_title.strip()


if __name__ == "__main__":
    """
    Scrapes Billboard Hot 100 songs from Wikipedia for a range of years (1960-2026),
    parses song titles and artists, and saves each year's data to a separate CSV file
    within a 'csvs' subfolder.
    """
    start_year = 1960
    end_year = 2026 # Script will run up to and including 2026

    # --- Logic to create "csv's" subfolder ---
    script_dir = os.path.dirname(os.path.abspath(__file__))
    csv_output_folder_name = "csvs" # Changed to 'csvs' (no apostrophe for easier path handling)
    csv_output_dir = os.path.join(script_dir, csv_output_folder_name)

    try:
        os.makedirs(csv_output_dir, exist_ok=True)
        print(f"Output directory for CSVs: '{csv_output_dir}'")
    except OSError as e:
        print(f"Error creating directory '{csv_output_dir}': {e}")
        exit()
    # --- End of directory logic ---

    total_songs_scraped_all_years = 0

    for year in range(start_year, end_year + 1):
        print(f"\n--- Processing Year: {year} ---")
        raw_songs_data = get_billboard_song_titles_for_year(year)

        if not raw_songs_data:
            print(f"No data found or fetched for the year {year}. Skipping.")
            time.sleep(1) # Polite delay even if no data, before next year
            continue

        parsed_songs_for_csv = []
        for (yr_str, rank, raw_track, raw_artist) in raw_songs_data:
            parsed_track_title = parse_song(raw_track)
            parsed_artist_name = parse_artist(raw_artist)
            
            if not parsed_track_title or not parsed_artist_name:
                # print(f"Skipping entry: Year {yr_str}, Rank {rank}, Raw: '{raw_track}' by '{raw_artist}' (empty after parse)")
                continue
                
            parsed_songs_for_csv.append({
                'Year': yr_str,
                'Rank': rank,
                'Track_Title': parsed_track_title,
                'Artist_Name': parsed_artist_name,
                'Raw_Track_Title': raw_track,
                'Raw_Artist_Name': raw_artist
            })

        if not parsed_songs_for_csv:
            print(f"No songs to write to CSV after parsing for year {year}.")
            time.sleep(1) # Polite delay
            continue

        csv_filename_only = f"billboard_hot100_{year}.csv"
        csv_full_path = os.path.join(csv_output_dir, csv_filename_only)

        try:
            with open(csv_full_path, mode='w', newline='', encoding='utf-8') as file:
                fieldnames = ['Year', 'Rank', 'Track_Title', 'Artist_Name', 'Raw_Track_Title', 'Raw_Artist_Name']
                writer = csv.DictWriter(file, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(parsed_songs_for_csv)
            
            print(f"Successfully wrote {len(parsed_songs_for_csv)} songs for year {year} to '{csv_full_path}'")
            total_songs_scraped_all_years += len(parsed_songs_for_csv)
        except IOError:
            print(f"Error: Could not write to CSV file '{csv_full_path}'.")
        except Exception as e:
            print(f"An unexpected error occurred while writing to CSV for year {year}: {e}")
        
        print(f"Waiting a moment before processing the next year...")
        time.sleep(2) # Add a 2-second delay between fetching each year to be polite to Wikipedia's servers

    print(f"\n--- Processing Complete ---")
    print(f"Total songs scraped across all processed years: {total_songs_scraped_all_years}")
    print(f"CSV files are located in: '{csv_output_dir}'")
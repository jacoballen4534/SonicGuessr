import requests
from bs4 import BeautifulSoup
import os
import csv # For writing CSV files

def get_billboard_song_titles_for_year(year):
    """
    Scrapes Wikipedia for billboard song titles for a given year.
    :return: List of billboard songs and artists in a tuple '(year, rank, song, artist)'
    """
    print(f"Fetching Billboard Hot 100 for {year} from Wikipedia...")
    billboard_page = "https://en.wikipedia.org/wiki/Billboard_Year-End_Hot_100_singles_of_"
    try:
        page = requests.get(billboard_page + str(year))
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
        row_data = [cell.text.strip().replace('"', '') for cell in cells]

        if len(row_data) == 3: # Rank, Title, Artist
            rank = row_data[0]
            track = row_data[1]
            artist = row_data[2]
            year_data.append((str(year), rank, track, artist)) # Ensure year is string for consistency
            rows_processed += 1
        elif len(row_data) == 2: 
            # print(f"Warning: Row for year {year} has only 2 columns, assuming Title, Artist: {row_data}")
            rank = str(rows_processed + 1) 
            track = row_data[0]
            artist = row_data[1]
            year_data.append((str(year), rank, track, artist))
            rows_processed += 1
        elif len(row_data) > 0 : 
            # print(f"Error Processing Row (unexpected number of columns {len(row_data)}): {row_data} for year {year}")
            errors_in_row_processing += 1
    
    if errors_in_row_processing > 0:
        print(f"Finished processing for year {year} with {errors_in_row_processing} row processing errors.")
    else:
        print(f"Successfully processed {rows_processed} songs for year {year}.")
    return year_data

def parse_artist(artist_text):
    """
    Cleans up artist string, primarily taking the first credited artist.
    """
    lower_artist_text = artist_text.lower()
    split_index = len(artist_text)
    # Order matters: more specific/longer separators first
    separators = [
        " featuring ", " feat. ", " feat ", 
        " with ", 
        " and ", # Be careful if "and" is part of an artist's name
        " & ", 
        " vs. ", " vs ",
        " presents ",
        " / ", # Can separate artists or be part of title
        " x ", # Common for collaborations
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
    """
    Cleans up song title string.
    """
    parsed_title = song_title
    # Separators that often denote alternative versions or less relevant parts
    # Order might matter if one is a substring of another
    title_truncate_separators = [" (", "[", " /", " - "] 
    
    split_index = len(parsed_title)
    for sep in title_truncate_separators:
        idx = parsed_title.find(sep)
        if idx != -1:
            split_index = min(split_index, idx)
            
    parsed_title = parsed_title[:split_index].strip()

    # Remove surrounding quotes if they are the very first and last characters
    if parsed_title.startswith('"') and parsed_title.endswith('"'):
        parsed_title = parsed_title[1:-1]
        
    return parsed_title.strip()


if __name__ == "__main__":
    year_input = input("What year's Billboard Hot 100 songs would you like to scrape? (e.g., 2000): ")
    if not (year_input.isdigit() and 1940 <= int(year_input) <= 2025):
        print("Error: Please enter a valid year (e.g., between 1940 and 2025).")
        exit()

    year = int(year_input)
    raw_songs_data = get_billboard_song_titles_for_year(year)

    if not raw_songs_data:
        print(f"No data found or fetched for the year {year}.")
        exit()

    parsed_songs_for_csv = []
    for (yr_str, rank, raw_track, raw_artist) in raw_songs_data:
        parsed_track_title = parse_song(raw_track)
        parsed_artist_name = parse_artist(raw_artist)
        
        if not parsed_track_title or not parsed_artist_name:
            # print(f"Skipping entry due to empty parsed title/artist: Year {yr_str}, Rank {rank}, Raw: '{raw_track}' by '{raw_artist}'")
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
        exit()

    # --- Logic to create "csv's" subfolder and define output path ---
    script_dir = os.path.dirname(os.path.abspath(__file__)) # Get directory where the script is
    csv_output_folder_name = "csv's"
    csv_output_dir = os.path.join(script_dir, csv_output_folder_name)

    try:
        os.makedirs(csv_output_dir, exist_ok=True) # Create the directory if it doesn't exist
        print(f"Ensured output directory exists: '{csv_output_dir}'")
    except OSError as e:
        print(f"Error creating directory '{csv_output_dir}': {e}")
        exit()

    csv_filename_only = f"billboard_hot100_{year}.csv"
    csv_full_path = os.path.join(csv_output_dir, csv_filename_only)
    # --- End of new directory logic ---

    try:
        with open(csv_full_path, mode='w', newline='', encoding='utf-8') as file:
            fieldnames = ['Year', 'Rank', 'Track_Title', 'Artist_Name', 'Raw_Track_Title', 'Raw_Artist_Name']
            writer = csv.DictWriter(file, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(parsed_songs_for_csv)
        
        print(f"\nSuccessfully wrote {len(parsed_songs_for_csv)} songs for the year {year} to '{csv_full_path}'")
    except IOError:
        print(f"Error: Could not write to CSV file '{csv_full_path}'. Check permissions or path.")
    except Exception as e:
        print(f"An unexpected error occurred while writing to CSV: {e}")
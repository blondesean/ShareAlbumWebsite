import { useEffect, useState } from "react";
import { Amplify } from "aws-amplify";
import { Authenticator } from "@aws-amplify/ui-react";
import { fetchAuthSession } from "aws-amplify/auth";
import "@aws-amplify/ui-react/styles.css";

// Configure Amplify with your Cognito settings
Amplify.configure({
    Auth: {
        Cognito: {
            userPoolId: "us-west-2_wWKJ8mrfJ",
            userPoolClientId: "4oe6jag3iv44j21ml27hh55sru",
            loginWith: {
                email: true,
            },
        },
    },
});

interface Photo {
    key: string;
    url: string;
    isFavorite?: boolean;
    tags?: string[];
    favoriteCount?: number;
}

const BASE_TAGS = import.meta.env.VITE_AVAILABLE_TAGS?.split(",") || 
    ["Jeff", "Karen", "Sean", "Kati", "Julia"
        , "Granmare", "Papa", "Gram", "Grandad"
        , "Mark", "Bob", "Greg", "Elizabeth", "Carie", "Ann Marie", "Mike"
        , "McGuire", "Jay", "Matt", "Lizzie", "Glenn", "Danny", "Kyle", "Steven", "Nicole"
        , "Kristen", "John", "Lee", "Carl", "Kristie", "Kathy"
        , "Daniel", "Kurt", "Bob"
        , "Patrick"
        , "Braden", "Kara", "Kelsey", "Kaitlyn"
        , "Steve", "Sean E"
        , "Owen", "Margot"
        , "Buddy", "Gigi", "Eddie", "Animals"];

function PhotoApp({ signOut }: { signOut?: () => void }) {
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; photoKey: string } | null>(null);
    const [tagModal, setTagModal] = useState<{ photoKey: string } | null>(null);
    const [photoTags, setPhotoTags] = useState<Map<string, Set<string>>>(new Map());
    const [selectedFilter, setSelectedFilter] = useState<string | null>(null);
    const [showTagRequest, setShowTagRequest] = useState(false);
    const [requestedTag, setRequestedTag] = useState("");
    const [availableTags, setAvailableTags] = useState<string[]>(() => {
        const customTags = localStorage.getItem("customTags");
        const custom = customTags ? JSON.parse(customTags) : [];
        return [...BASE_TAGS, ...custom];
    });
    // Always show all years from 1960 to 2025 in the dropdown
    const ALL_YEARS = Array.from({ length: 2025 - 1960 + 1 }, (_, i) => String(1960 + i));
    const yearTags = new Set(ALL_YEARS);
    // Always show all 12 months in the dropdown
    const ALL_MONTHS = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
    const monthTags = new Set(ALL_MONTHS);
    const [selectedYears, setSelectedYears] = useState<Set<string>>(new Set());
    const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set());
    const [showYearDropdown, setShowYearDropdown] = useState(false);
    const [showMonthDropdown, setShowMonthDropdown] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<string | null>(null);
    const [uploadQueue, setUploadQueue] = useState<{total: number, completed: number, failed: number}>({total: 0, completed: 0, failed: 0});

    // Helper function to extract year from photo name
    const extractYearFromPhotoName = (photoKey: string): string | null => {
        // Extract filename from the key (remove path if present)
        const filename = photoKey.split('/').pop() || photoKey;
        
        // Check if filename starts with a 4-digit year (19xx or 20xx)
        const yearMatch = filename.match(/^(19\d{2}|20\d{2})/);
        return yearMatch ? yearMatch[1] : null;
    };

    // Helper function to extract month from photo name
    const extractMonthFromPhotoName = (photoKey: string): string | null => {
        // Extract filename from the key (remove path if present)
        const filename = photoKey.split('/').pop() || photoKey;
        
        // List of month names to search for
        const monthNames = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ];
        
        // Convert filename to lowercase for case-insensitive matching
        const lowerFilename = filename.toLowerCase();
        
        // Check if any month name appears in the filename
        for (const month of monthNames) {
            if (lowerFilename.includes(month.toLowerCase())) {
                return month;
            }
        }
        
        return null;
    };

    // Helper function to filter photos: only filter out non-_a.jpg versions if _a.jpg exists
    const filterDuplicatePhotos = (photos: Photo[]): Photo[] => {
        // Create a set of all photo keys for quick lookup
        const photoKeys = new Set(photos.map(p => p.key));
        
        return photos.filter((photo) => {
            const key = photo.key;
            

            
            // If it's an _a.jpg version, always keep it
            if (key.includes("_a.jpg")) {
                return true;
            }
            
            const filename = key.split('/').pop() || key;
            const lastSlashIndex = key.lastIndexOf('/');
            const path = lastSlashIndex >= 0 ? key.substring(0, lastSlashIndex + 1) : '';
            
            // Filter out _b.jpg if _a.jpg exists
            if (filename.includes("_b.jpg")) {
                // Try to find the corresponding _a.jpg version
                const baseName = filename.replace("_b.jpg", "");
                const enhancedName = `${baseName}_a.jpg`;
                const enhancedKey = path + enhancedName;
                
                // If _a.jpg version exists, filter out this _b.jpg
                if (photoKeys.has(enhancedKey)) {
                    return false;
                }
            }
            
            // Check if this photo matches the pattern <YEAR>_<MONTH>_<NUMBER>.jpg
            // and if there's a corresponding _a.jpg version
            // Pattern: <YEAR>_<MONTH>_<NUMBER>.jpg
            // We'll check if removing .jpg and adding _a.jpg exists
            if (filename.endsWith(".jpg") && !filename.includes("_a.jpg") && !filename.includes("_b.jpg")) {
                // Try to find the _a.jpg version
                const baseName = filename.replace(".jpg", "");
                const enhancedName = `${baseName}_a.jpg`;
                const enhancedKey = path + enhancedName;
                
                // If enhanced version exists, filter out this one
                if (photoKeys.has(enhancedKey)) {
                    return false;
                }
            }
            return true;
        });
    };

    useEffect(() => {
        async function fetchPhotos() {
            try {


                // Get Cognito ID token (required for API Gateway Cognito User Pool authorizer)
                const session = await fetchAuthSession();
                const idToken = session.tokens?.idToken?.toString();



                if (!idToken) {
                    throw new Error("No ID token available - please sign out and sign back in");
                }

                const response = await fetch(import.meta.env.VITE_API_URL, {
                    headers: {
                        Authorization: `Bearer ${idToken}`,
                    },
                });

                if (!response.ok) {
                    const text = await response.text();
                    throw new Error(`Failed to fetch photos: ${response.status} ${text}`);
                }
                  
                const data = await response.json();
                

                
                const filteredPhotos = filterDuplicatePhotos(data);
                
                // Extract years and months from photo names and collect unique values
                const detectedYears = new Set<string>();
                const detectedMonths = new Set<string>();
                filteredPhotos.forEach((photo: Photo) => {
                    const year = extractYearFromPhotoName(photo.key);
                    if (year) {
                        detectedYears.add(year);
                    }
                    const month = extractMonthFromPhotoName(photo.key);
                    if (month) {
                        detectedMonths.add(month);
                    }
                });
                // yearTags and monthTags always contain all years/months, so we don't need to update them
                
                // Mark favorites and sort (favorites first)
                const photosWithFavorites = filteredPhotos.map((photo: Photo) => ({
                    ...photo,
                    isFavorite: photo.isFavorite || false,
                }));
                
                // Sort: by favorite count (desc), then by year (desc), then by month (chronological)
                photosWithFavorites.sort((a: Photo, b: Photo) => {
                    // 1. Sort by favorite count (higher counts first)
                    const aFavCount = a.favoriteCount || 0;
                    const bFavCount = b.favoriteCount || 0;
                    if (aFavCount !== bFavCount) {
                        return bFavCount - aFavCount;
                    }
                    
                    // 2. Sort by year (newer years first)
                    const aYear = extractYearFromPhotoName(a.key);
                    const bYear = extractYearFromPhotoName(b.key);
                    if (aYear && bYear && aYear !== bYear) {
                        return parseInt(bYear) - parseInt(aYear);
                    }
                    if (aYear && !bYear) return -1;
                    if (!aYear && bYear) return 1;
                    
                    // 3. Sort by month (chronological order within same year)
                    const aMonth = extractMonthFromPhotoName(a.key);
                    const bMonth = extractMonthFromPhotoName(b.key);
                    if (aMonth && bMonth && aMonth !== bMonth) {
                        const monthOrder = [
                            "January", "February", "March", "April", "May", "June",
                            "July", "August", "September", "October", "November", "December"
                        ];
                        return monthOrder.indexOf(aMonth) - monthOrder.indexOf(bMonth);
                    }
                    if (aMonth && !bMonth) return -1;
                    if (!aMonth && bMonth) return 1;
                    
                    // 4. Finally sort by photo key as tiebreaker
                    return a.key.localeCompare(b.key);
                });
                
                setPhotos(photosWithFavorites);
                
                // Build favorites set
                const favSet = new Set<string>(photosWithFavorites.filter((p: Photo) => p.isFavorite).map((p: Photo) => p.key));
                setFavorites(favSet);

                // Fetch tags for all photos
                await fetchAllTags(idToken, photosWithFavorites);
            } catch (err: any) {
                console.error(err);
                setError(err.message);
            }
        }
        fetchPhotos();
    }, []);

    const fetchAllTags = async (idToken: string, photosList: Photo[]) => {
        const tagsMap = new Map<string, Set<string>>();
        
        for (const photo of photosList) {
            try {
                const apiUrl = import.meta.env.VITE_API_URL.replace("/photos", `/tags?photoKey=${encodeURIComponent(photo.key)}`);
                const response = await fetch(apiUrl, {
                    headers: {
                        Authorization: `Bearer ${idToken}`,
                    },
                });
                
                if (response.ok) {
                    const data = await response.json();
                    const tags = new Set<string>(data.tags?.map((t: { tag: string }) => t.tag) || []);
                    
                    // Add year and month tags if photo name contains them
                    const year = extractYearFromPhotoName(photo.key);
                    if (year) {
                        tags.add(year);
                    }
                    const month = extractMonthFromPhotoName(photo.key);
                    if (month) {
                        tags.add(month);
                    }
                    
                    if (tags.size > 0) {
                        tagsMap.set(photo.key, tags);
                    }
                } else {
                    console.warn(`Failed to fetch tags for ${photo.key}, status:`, response.status);
                    
                    // Even if API call fails, still add year and month tags if available
                    const tags = new Set<string>();
                    const year = extractYearFromPhotoName(photo.key);
                    if (year) {
                        tags.add(year);
                    }
                    const month = extractMonthFromPhotoName(photo.key);
                    if (month) {
                        tags.add(month);
                    }
                    if (tags.size > 0) {
                        tagsMap.set(photo.key, tags);
                    }
                }
            } catch (err) {
                console.error(`Failed to fetch tags for ${photo.key}`, err);
                
                // Even if API call fails, still add year and month tags if available
                const tags = new Set<string>();
                const year = extractYearFromPhotoName(photo.key);
                if (year) {
                    tags.add(year);
                }
                const month = extractMonthFromPhotoName(photo.key);
                if (month) {
                    tags.add(month);
                }
                if (tags.size > 0) {
                    tagsMap.set(photo.key, tags);
                }
            }
        }
        
        setPhotoTags(tagsMap);
    };

    const toggleFavorite = async (photoKey: string) => {
        try {
            const session = await fetchAuthSession();
            const idToken = session.tokens?.idToken?.toString();

            if (!idToken) {
                throw new Error("No ID token available");
            }

            const isFavorite = favorites.has(photoKey);
            const method = isFavorite ? "DELETE" : "POST";
            const apiUrl = import.meta.env.VITE_API_URL.replace("/photos", "/favorites");

            const response = await fetch(apiUrl, {
                method,
                headers: {
                    Authorization: `Bearer ${idToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ photoKey }),
            });

            if (!response.ok) throw new Error("Failed to update favorite");

            // Update local state (just toggle the border, don't re-sort)
            const newFavorites = new Set(favorites);
            if (isFavorite) {
                newFavorites.delete(photoKey);
            } else {
                newFavorites.add(photoKey);
            }
            setFavorites(newFavorites);
        } catch (err: any) {
            console.error(err);
            setError(err.message);
        }
    };

    const toggleTag = async (photoKey: string, tag: string) => {
        try {
            const session = await fetchAuthSession();
            const idToken = session.tokens?.idToken?.toString();

            if (!idToken) {
                throw new Error("No ID token available");
            }

            const currentTags = photoTags.get(photoKey) || new Set<string>();
            const hasTag = currentTags.has(tag);
            const method = hasTag ? "DELETE" : "POST";
            const apiUrl = import.meta.env.VITE_API_URL.replace("/photos", "/tags");

            const response = await fetch(apiUrl, {
                method,
                headers: {
                    Authorization: `Bearer ${idToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ photoKey, tag }),
            });

            if (!response.ok) throw new Error("Failed to update tag");

            // Update local state
            const newTags = new Set(currentTags);
            if (hasTag) {
                newTags.delete(tag);
            } else {
                newTags.add(tag);
            }
            
            const newPhotoTags = new Map(photoTags);
            newPhotoTags.set(photoKey, newTags);
            setPhotoTags(newPhotoTags);
        } catch (err: any) {
            console.error(err);
            setError(err.message);
        }
    };

    const createNewTag = async () => {
        if (!requestedTag.trim()) return;
        
        const newTag = requestedTag.trim();
        
        // Check if tag already exists
        if (availableTags.includes(newTag)) {
            alert("This tag already exists!");
            return;
        }
        
        // Add to available tags
        const updatedTags = [...availableTags, newTag];
        setAvailableTags(updatedTags);
        
        // Save custom tags to localStorage (only the ones not in BASE_TAGS)
        const customTags = updatedTags.filter(tag => !BASE_TAGS.includes(tag));
        localStorage.setItem("customTags", JSON.stringify(customTags));
        
        // Apply the new tag to the current photo
        if (tagModal) {
            await toggleTag(tagModal.photoKey, newTag);
        }
        
        setRequestedTag("");
        setShowTagRequest(false);
    };



    const uploadMultiplePhotos = async (files: File[]) => {
        setUploading(true);
        setUploadQueue({total: files.length, completed: 0, failed: 0});
        setUploadProgress(`Uploading ${files.length} photos...`);

        const results = {
            successful: 0,
            failed: 0,
            errors: [] as string[]
        };

        // Upload files sequentially to avoid overwhelming the API
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                setUploadProgress(`Uploading ${i + 1} of ${files.length}: ${file.name}`);
                
                // Get Cognito ID token
                const session = await fetchAuthSession();
                const idToken = session.tokens?.idToken?.toString();

                if (!idToken) {
                    throw new Error("No ID token available");
                }

                // Step 1: Get upload URL
                const uploadApiUrl = 'https://mtkjcuwe3g.execute-api.us-west-2.amazonaws.com/prod/upload-url';
                const uploadUrlResponse = await fetch(uploadApiUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${idToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        fileName: file.name,
                        fileType: file.type
                    })
                });

                if (!uploadUrlResponse.ok) {
                    const errorText = await uploadUrlResponse.text();
                    throw new Error(`Failed to get upload URL: ${uploadUrlResponse.status} - ${errorText}`);
                }

                const uploadData = await uploadUrlResponse.json();
                const { uploadUrl, key } = uploadData;
                
                if (!uploadUrl) {
                    throw new Error("No upload URL received from server");
                }

                // Step 2: Upload file directly to S3
                const uploadResponse = await fetch(uploadUrl, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': file.type
                    },
                    body: file
                });

                if (!uploadResponse.ok) {
                    const errorText = await uploadResponse.text();
                    throw new Error(`Failed to upload to S3: ${uploadResponse.status} - ${errorText}`);
                }

                results.successful++;
                console.log(`Upload ${i + 1}/${files.length} successful:`, key);
                
                // Update progress
                setUploadQueue(prev => ({...prev, completed: prev.completed + 1}));

            } catch (err: any) {
                results.failed++;
                results.errors.push(`${file.name}: ${err.message}`);
                console.error(`Upload ${i + 1}/${files.length} failed:`, err);
                
                // Update progress
                setUploadQueue(prev => ({...prev, failed: prev.failed + 1}));
            }
        }

        // Show final results
        if (results.successful > 0) {
            setUploadProgress(`Upload complete! ${results.successful} photos uploaded successfully.`);
            
            // Refresh photos after a short delay
            setTimeout(async () => {
                try {
                    const session = await fetchAuthSession();
                    const idToken = session.tokens?.idToken?.toString();

                    if (!idToken) {
                        throw new Error("No ID token available");
                    }
                    
                    const response = await fetch(import.meta.env.VITE_API_URL, {
                        headers: {
                            Authorization: `Bearer ${idToken}`,
                        },
                    });

                    if (response.ok) {
                        const data = await response.json();
                        const filteredPhotos = data.filter((photo: Photo) => photo.key.includes("_a.jpg"));
                        
                        // Extract years and months from photo names and collect unique values
                        const detectedYears = new Set<string>();
                        const detectedMonths = new Set<string>();
                        filteredPhotos.forEach((photo: Photo) => {
                            const year = extractYearFromPhotoName(photo.key);
                            if (year) {
                                detectedYears.add(year);
                            }
                            const month = extractMonthFromPhotoName(photo.key);
                            if (month) {
                                detectedMonths.add(month);
                            }
                        });
                        // Note: yearTags and monthTags are set in the main useEffect
                        
                        const photosWithFavorites = filteredPhotos.map((photo: Photo) => ({
                            ...photo,
                            isFavorite: photo.isFavorite || false,
                        }));
                        
                        photosWithFavorites.sort((a: Photo, b: Photo) => {
                            // 1. Sort by favorite count (higher counts first)
                            const aFavCount = a.favoriteCount || 0;
                            const bFavCount = b.favoriteCount || 0;
                            if (aFavCount !== bFavCount) {
                                return bFavCount - aFavCount;
                            }
                            
                            // 2. Sort by year (newer years first)
                            const aYear = extractYearFromPhotoName(a.key);
                            const bYear = extractYearFromPhotoName(b.key);
                            if (aYear && bYear && aYear !== bYear) {
                                return parseInt(bYear) - parseInt(aYear);
                            }
                            if (aYear && !bYear) return -1;
                            if (!aYear && bYear) return 1;
                            
                            // 3. Sort by month (chronological order within same year)
                            const aMonth = extractMonthFromPhotoName(a.key);
                            const bMonth = extractMonthFromPhotoName(b.key);
                            if (aMonth && bMonth && aMonth !== bMonth) {
                                const monthOrder = [
                                    "January", "February", "March", "April", "May", "June",
                                    "July", "August", "September", "October", "November", "December"
                                ];
                                return monthOrder.indexOf(aMonth) - monthOrder.indexOf(bMonth);
                            }
                            if (aMonth && !bMonth) return -1;
                            if (!aMonth && bMonth) return 1;
                            
                            // 4. Finally sort by photo key as tiebreaker
                            return a.key.localeCompare(b.key);
                        });
                        
                        setPhotos(photosWithFavorites);
                        
                        const favSet = new Set<string>(photosWithFavorites.filter((p: Photo) => p.isFavorite).map((p: Photo) => p.key));
                        setFavorites(favSet);

                        await fetchAllTags(idToken, photosWithFavorites);
                    }
                } catch (refreshError) {
                    console.error("Failed to refresh photos:", refreshError);
                }
                
                setUploadProgress(null);
                setUploading(false);
                setUploadQueue({total: 0, completed: 0, failed: 0});
            }, 2000);
        } else {
            setError(`All uploads failed. ${results.errors.join('; ')}`);
            setUploadProgress(null);
            setUploading(false);
            setUploadQueue({total: 0, completed: 0, failed: 0});
        }

        if (results.failed > 0) {
            console.warn("Some uploads failed:", results.errors);
        }
    };

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (files && files.length > 0) {
            const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
            const validFiles: File[] = [];
            const invalidFiles: string[] = [];
            
            // Validate all selected files
            Array.from(files).forEach(file => {
                if (allowedTypes.includes(file.type)) {
                    validFiles.push(file);
                } else {
                    invalidFiles.push(file.name);
                }
            });
            
            if (invalidFiles.length > 0) {
                setError(`Invalid file types: ${invalidFiles.join(', ')}. Please select only JPEG, PNG, GIF, or WebP files.`);
                return;
            }
            
            if (validFiles.length > 0) {
                // Clear any previous errors
                setError(null);
                uploadMultiplePhotos(validFiles);
            }
        }
        
        // Reset the input so the same files can be selected again
        event.target.value = '';
    };

    const filteredPhotos = photos.filter((photo) => {
        const tags = photoTags.get(photo.key) || new Set<string>();
        
        // Apply single tag filter if selected
        if (selectedFilter && !tags.has(selectedFilter)) {
            return false;
        }
        
        // Apply year filters if any selected
        if (selectedYears.size > 0) {
            const hasSelectedYear = Array.from(selectedYears).some(year => tags.has(year));
            if (!hasSelectedYear) return false;
        }
        
        // Apply month filters if any selected
        if (selectedMonths.size > 0) {
            const hasSelectedMonth = Array.from(selectedMonths).some(month => tags.has(month));
            if (!hasSelectedMonth) return false;
        }
        
        return true;
    });

    return (
        <div
            style={{ padding: "1rem" }}
            onClick={() => {
                setContextMenu(null);
                setShowYearDropdown(false);
                setShowMonthDropdown(false);
            }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h1>Family Shared Album</h1>
                <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                    {/* Upload Button */}
                    <div style={{ position: "relative" }}>
                        <input
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={handleFileSelect}
                            style={{ display: "none" }}
                            id="photo-upload"
                            disabled={uploading}
                        />
                        <label
                            htmlFor="photo-upload"
                            style={{
                                padding: "8px 16px",
                                backgroundColor: uploading ? "#6c757d" : "#28a745",
                                color: "white",
                                border: "none",
                                borderRadius: "4px",
                                cursor: uploading ? "not-allowed" : "pointer",
                                fontSize: "0.9rem",
                                fontWeight: "bold",
                                display: "inline-block",
                            }}
                        >
                            {uploading ? "Uploading..." : "📷 Upload Photos"}
                        </label>
                    </div>
                    




                    <button onClick={signOut}>Sign Out</button>
                </div>
            </div>

            {/* Upload Progress */}
            {uploadProgress && (
                <div style={{ 
                    marginBottom: "1rem", 
                    padding: "8px 12px", 
                    backgroundColor: "#d1ecf1", 
                    color: "#0c5460", 
                    borderRadius: "4px",
                    fontSize: "0.9rem"
                }}>
                    {uploadProgress}
                    {uploadQueue.total > 1 && (
                        <div style={{ fontSize: "0.8rem", marginTop: "4px" }}>
                            Progress: {uploadQueue.completed + uploadQueue.failed} / {uploadQueue.total} 
                            {uploadQueue.failed > 0 && ` (${uploadQueue.failed} failed)`}
                        </div>
                    )}
                </div>
            )}

            {/* Filter Controls */}
            <div style={{ marginBottom: "1rem", display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontWeight: "bold" }}>Filters:</span>
                
                {/* Clear All Filters */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFilter(null);
                        setSelectedYears(new Set());
                        setSelectedMonths(new Set());
                    }}
                    style={{
                        padding: "6px 12px",
                        border: "1px solid #ccc",
                        borderRadius: "4px",
                        background: selectedFilter === null && selectedYears.size === 0 && selectedMonths.size === 0 ? "#007bff" : "white",
                        color: selectedFilter === null && selectedYears.size === 0 && selectedMonths.size === 0 ? "white" : "black",
                        cursor: "pointer",
                    }}
                >
                    Clear All
                </button>
                
                {/* Year Dropdown */}
                <div style={{ position: "relative" }}>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowYearDropdown(!showYearDropdown);
                            setShowMonthDropdown(false);
                        }}
                        style={{
                            padding: "6px 12px",
                            border: "1px solid #28a745",
                            borderRadius: "4px",
                            background: selectedYears.size > 0 ? "#28a745" : "white",
                            color: selectedYears.size > 0 ? "white" : "#28a745",
                            cursor: "pointer",
                            fontWeight: "bold",
                        }}
                    >
                        Years {selectedYears.size > 0 ? `(${selectedYears.size})` : ""} ▼
                    </button>
                    {showYearDropdown && (
                        <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                position: "absolute",
                                top: "100%",
                                left: 0,
                                backgroundColor: "white",
                                border: "1px solid #28a745",
                                borderRadius: "4px",
                                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                                zIndex: 1000,
                                minWidth: "120px",
                                maxHeight: "300px",
                                overflowY: "auto",
                            }}
                        >
                                {Array.from(yearTags).sort().map((year: string) => (
                                    <label
                                        key={year}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px",
                                            padding: "8px 12px",
                                            cursor: "pointer",
                                            backgroundColor: selectedYears.has(year) ? "#d4edda" : "transparent",
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!selectedYears.has(year)) {
                                                e.currentTarget.style.backgroundColor = "#f8f9fa";
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!selectedYears.has(year)) {
                                                e.currentTarget.style.backgroundColor = "transparent";
                                            }
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedYears.has(year)}
                                            onChange={() => {
                                                const newSelected = new Set(selectedYears);
                                                if (newSelected.has(year)) {
                                                    newSelected.delete(year);
                                                } else {
                                                    newSelected.add(year);
                                                }
                                                setSelectedYears(newSelected);
                                            }}
                                            style={{ cursor: "pointer" }}
                                        />
                                        <span style={{ fontWeight: "bold", color: "#155724" }}>{year}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                
                {/* Month Dropdown */}
                {monthTags.size > 0 && (
                    <div style={{ position: "relative" }}>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowMonthDropdown(!showMonthDropdown);
                                setShowYearDropdown(false);
                            }}
                            style={{
                                padding: "6px 12px",
                                border: "1px solid #007bff",
                                borderRadius: "4px",
                                background: selectedMonths.size > 0 ? "#007bff" : "white",
                                color: selectedMonths.size > 0 ? "white" : "#007bff",
                                cursor: "pointer",
                                fontWeight: "bold",
                            }}
                        >
                            Months {selectedMonths.size > 0 ? `(${selectedMonths.size})` : ""} ▼
                        </button>
                        {showMonthDropdown && (
                            <div
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                    position: "absolute",
                                    top: "100%",
                                    left: 0,
                                    backgroundColor: "white",
                                    border: "1px solid #007bff",
                                    borderRadius: "4px",
                                    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                                    zIndex: 1000,
                                    minWidth: "140px",
                                }}
                            >
                                {Array.from(monthTags).sort((a, b) => {
                                    const monthOrder = [
                                        "January", "February", "March", "April", "May", "June",
                                        "July", "August", "September", "October", "November", "December"
                                    ];
                                    return monthOrder.indexOf(a) - monthOrder.indexOf(b);
                                }).map((month: string) => (
                                    <label
                                        key={month}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px",
                                            padding: "8px 12px",
                                            cursor: "pointer",
                                            backgroundColor: selectedMonths.has(month) ? "#cce7ff" : "transparent",
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!selectedMonths.has(month)) {
                                                e.currentTarget.style.backgroundColor = "#f8f9fa";
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!selectedMonths.has(month)) {
                                                e.currentTarget.style.backgroundColor = "transparent";
                                            }
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedMonths.has(month)}
                                            onChange={() => {
                                                const newSelected = new Set(selectedMonths);
                                                if (newSelected.has(month)) {
                                                    newSelected.delete(month);
                                                } else {
                                                    newSelected.add(month);
                                                }
                                                setSelectedMonths(newSelected);
                                            }}
                                            style={{ cursor: "pointer" }}
                                        />
                                        <span style={{ fontWeight: "bold", color: "#0056b3" }}>{month}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                
                {/* Regular Tags Section */}
                <span style={{ fontWeight: "bold", color: "#666" }}>People & Tags:</span>
                {availableTags.map((tag: string) => (
                    <button
                        key={tag}
                        onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFilter(selectedFilter === tag ? null : tag);
                        }}
                        style={{
                            padding: "6px 12px",
                            border: "1px solid #ccc",
                            borderRadius: "4px",
                            background: selectedFilter === tag ? "#007bff" : "white",
                            color: selectedFilter === tag ? "white" : "black",
                            cursor: "pointer",
                        }}
                    >
                        {tag}
                    </button>
                ))}
            </div>

            {error && <p style={{ color: "red" }}>Error: {error}</p>}
            {!error && !filteredPhotos.length && <p>Loading photos...</p>}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: "10px",
                }}
            >
                {filteredPhotos.map((photo) => {
                    const tags = photoTags.get(photo.key) || new Set<string>();
                    return (
                        <div
                            key={photo.key}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                setContextMenu({ x: e.clientX, y: e.clientY, photoKey: photo.key });
                            }}
                            style={{ cursor: "pointer", position: "relative" }}
                        >
                            <div style={{ position: "relative" }}>
                                <img
                                    src={photo.url}
                                    alt={photo.key}
                                    style={{
                                        width: "100%",
                                        borderRadius: "8px",
                                        border: favorites.has(photo.key) ? "4px solid gold" : "none",
                                    }}


                                />
                                {/* Favorite Count - bottom right corner of photo */}
                                {photo.favoriteCount !== undefined && photo.favoriteCount > 0 && (
                                    <div
                                        style={{
                                            position: "absolute",
                                            bottom: "8px",
                                            right: "8px",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "4px",
                                            fontSize: "0.9rem",
                                            color: "white",
                                            backgroundColor: "rgba(0, 0, 0, 0.6)",
                                            padding: "4px 8px",
                                            borderRadius: "12px",
                                            fontWeight: "bold",
                                        }}
                                    >
                                        ❤️ {photo.favoriteCount}
                                    </div>
                                )}
                            </div>
                            <p style={{ 
                                fontSize: "0.9rem", 
                                wordWrap: "break-word", 
                                overflowWrap: "break-word",
                                hyphens: "auto",
                                margin: "4px 0"
                            }}>{photo.key}</p>
                            {tags.size > 0 && (
                                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "4px" }}>
                                    {Array.from(tags).map((tag) => {
                                        // Check tag type
                                        const isYearTag = /^(19\d{2}|20\d{2})$/.test(tag);
                                        const isMonthTag = ["January", "February", "March", "April", "May", "June",
                                            "July", "August", "September", "October", "November", "December"].includes(tag);
                                        const isBaseTag = BASE_TAGS.includes(tag);
                                        const isUserTag = !isBaseTag && !isYearTag && !isMonthTag;
                                        

                                        
                                        let backgroundColor = "#e6ccff"; // Purple for base tags (people & tags)
                                        let color = "#6f42c1";
                                        
                                        if (isYearTag) {
                                            backgroundColor = "#d4edda";
                                            color = "#155724";
                                        } else if (isMonthTag) {
                                            backgroundColor = "#cce7ff";
                                            color = "#0056b3";
                                        } else if (isUserTag) {
                                            backgroundColor = "#ffc0cb"; // Pink for custom tags
                                            color = "#8b008b";
                                        }
                                        // Base tags use purple styling
                                        
                                        return (
                                            <span
                                                key={tag}
                                                style={{
                                                    fontSize: "0.75rem",
                                                    padding: "2px 6px",
                                                    backgroundColor,
                                                    color,
                                                    borderRadius: "4px",
                                                    fontWeight: (isYearTag || isMonthTag) ? "bold" : "normal",
                                                }}
                                            >
                                                {tag}
                                            </span>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {contextMenu && (
                <div
                    style={{
                        position: "fixed",
                        top: contextMenu.y,
                        left: contextMenu.x,
                        backgroundColor: "white",
                        border: "1px solid #ccc",
                        borderRadius: "4px",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                        padding: "4px 0",
                        zIndex: 1000,
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={() => {
                            toggleFavorite(contextMenu.photoKey);
                            setContextMenu(null);
                        }}
                        style={{
                            display: "block",
                            width: "100%",
                            padding: "8px 16px",
                            border: "none",
                            background: "none",
                            textAlign: "left",
                            cursor: "pointer",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f0f0f0")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                        {favorites.has(contextMenu.photoKey) ? "Remove Favorite" : "Make Favorite"}
                    </button>
                    <button
                        onClick={() => {
                            setTagModal({ photoKey: contextMenu.photoKey });
                            setContextMenu(null);
                        }}
                        style={{
                            display: "block",
                            width: "100%",
                            padding: "8px 16px",
                            border: "none",
                            background: "none",
                            textAlign: "left",
                            cursor: "pointer",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f0f0f0")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                        Tag Photo
                    </button>
                </div>
            )}

            {tagModal && (
                <div
                    style={{
                        position: "fixed",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: "rgba(0,0,0,0.5)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 2000,
                    }}
                    onClick={() => setTagModal(null)}
                >
                    <div
                        style={{
                            backgroundColor: "white",
                            padding: "20px",
                            borderRadius: "8px",
                            minWidth: "500px",
                            maxWidth: "600px",
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 style={{ marginTop: 0 }}>Select Tags</h3>
                        
                        <div style={{ display: "flex", gap: "16px", maxHeight: "400px", overflowY: "auto" }}>
                            {/* People & Names Column */}
                            <div style={{ flex: 1, minWidth: "150px" }}>
                                <h4 style={{ margin: "0 0 8px 0", fontSize: "0.9rem", color: "#666", borderBottom: "1px solid #eee", paddingBottom: "4px" }}>
                                    People & Names
                                </h4>
                                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                    {availableTags.map((tag: string) => {
                                        const isSelected = photoTags.get(tagModal.photoKey)?.has(tag) || false;
                                        const isBaseTag = BASE_TAGS.includes(tag);
                                        const isUserTag = !isBaseTag;
                                        
                                        // Set colors based on tag type
                                        let backgroundColor = isSelected ? "#f0e6ff" : "transparent"; // Purple for base tags
                                        let textColor = isSelected ? "#6f42c1" : "inherit";
                                        
                                        if (isUserTag) {
                                            backgroundColor = isSelected ? "#ffc0cb" : "transparent"; // Pink for custom tags
                                            textColor = isSelected ? "#8b008b" : "inherit";
                                        }
                                        
                                        return (
                                            <label
                                                key={tag}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "6px",
                                                    padding: "4px 6px",
                                                    cursor: "pointer",
                                                    borderRadius: "4px",
                                                    backgroundColor,
                                                    fontSize: "0.85rem",
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleTag(tagModal.photoKey, tag)}
                                                    style={{ cursor: "pointer" }}
                                                />
                                                <span style={{ color: textColor }}>{tag}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                            
                            {/* Years Column */}
                            <div style={{ flex: 1, minWidth: "120px" }}>
                                <h4 style={{ margin: "0 0 8px 0", fontSize: "0.9rem", color: "#666", borderBottom: "1px solid #eee", paddingBottom: "4px" }}>
                                    Years
                                </h4>
                                <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "350px", overflowY: "auto" }}>
                                    {Array.from(yearTags).sort().map((year: string) => {
                                        const isSelected = photoTags.get(tagModal.photoKey)?.has(year) || false;
                                        return (
                                            <label
                                                key={year}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "6px",
                                                    padding: "4px 6px",
                                                    cursor: "pointer",
                                                    borderRadius: "4px",
                                                    backgroundColor: isSelected ? "#d4edda" : "transparent",
                                                    fontSize: "0.85rem",
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleTag(tagModal.photoKey, year)}
                                                    style={{ cursor: "pointer" }}
                                                />
                                                <span style={{ fontWeight: "bold", color: isSelected ? "#155724" : "#28a745" }}>{year}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                            
                            {/* Months Column */}
                            <div style={{ flex: 1, minWidth: "120px" }}>
                                <h4 style={{ margin: "0 0 8px 0", fontSize: "0.9rem", color: "#666", borderBottom: "1px solid #eee", paddingBottom: "4px" }}>
                                    Months
                                </h4>
                                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                    {Array.from(monthTags).sort((a, b) => {
                                        const monthOrder = [
                                            "January", "February", "March", "April", "May", "June",
                                            "July", "August", "September", "October", "November", "December"
                                        ];
                                        return monthOrder.indexOf(a) - monthOrder.indexOf(b);
                                    }).map((month: string) => {
                                        const isSelected = photoTags.get(tagModal.photoKey)?.has(month) || false;
                                        return (
                                            <label
                                                key={month}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "6px",
                                                    padding: "4px 6px",
                                                    cursor: "pointer",
                                                    borderRadius: "4px",
                                                    backgroundColor: isSelected ? "#cce7ff" : "transparent",
                                                    fontSize: "0.85rem",
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleTag(tagModal.photoKey, month)}
                                                    style={{ cursor: "pointer" }}
                                                />
                                                <span style={{ fontWeight: "bold", color: isSelected ? "#0056b3" : "#007bff" }}>{month}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                        
                        {!showTagRequest ? (
                            <button
                                onClick={() => setShowTagRequest(true)}
                                style={{
                                    marginTop: "12px",
                                    padding: "6px 12px",
                                    backgroundColor: "transparent",
                                    color: "#007bff",
                                    border: "1px solid #007bff",
                                    borderRadius: "4px",
                                    cursor: "pointer",
                                    width: "100%",
                                    fontSize: "0.9rem",
                                }}
                            >
                                + Create Custom Tag (only for you)
                            </button>
                        ) : (
                            <div style={{ marginTop: "12px" }}>
                                <input
                                    type="text"
                                    value={requestedTag}
                                    onChange={(e) => setRequestedTag(e.target.value)}
                                    placeholder="Enter tag name..."
                                    style={{
                                        width: "100%",
                                        padding: "8px",
                                        border: "1px solid #ccc",
                                        borderRadius: "4px",
                                        marginBottom: "8px",
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") createNewTag();
                                        if (e.key === "Escape") {
                                            setShowTagRequest(false);
                                            setRequestedTag("");
                                        }
                                    }}
                                    autoFocus
                                />
                                <div style={{ display: "flex", gap: "8px" }}>
                                    <button
                                        onClick={createNewTag}
                                        style={{
                                            flex: 1,
                                            padding: "6px 12px",
                                            backgroundColor: "#28a745",
                                            color: "white",
                                            border: "none",
                                            borderRadius: "4px",
                                            cursor: "pointer",
                                        }}
                                    >
                                        Create & Apply
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowTagRequest(false);
                                            setRequestedTag("");
                                        }}
                                        style={{
                                            flex: 1,
                                            padding: "6px 12px",
                                            backgroundColor: "#6c757d",
                                            color: "white",
                                            border: "none",
                                            borderRadius: "4px",
                                            cursor: "pointer",
                                        }}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}

                        <button
                            onClick={() => {
                                setTagModal(null);
                                setShowTagRequest(false);
                                setRequestedTag("");
                            }}
                            style={{
                                marginTop: "16px",
                                padding: "8px 16px",
                                backgroundColor: "#007bff",
                                color: "white",
                                border: "none",
                                borderRadius: "4px",
                                cursor: "pointer",
                                width: "100%",
                            }}
                        >
                            Done
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function App() {
    return (
        <Authenticator>
            {({ signOut }) => <PhotoApp signOut={signOut} />}
        </Authenticator>
    );
}

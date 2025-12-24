import { useEffect, useState, useRef } from "react";
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
        ,"Keegan", "Ryan", "Hande"
        , "Steve", "Sean E"
        , "Owen", "Margot"
        , "Buddy", "Gigi", "Eddie", "Animals"
        , "Uploaded"];

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
    const [bulkTagMode, setBulkTagMode] = useState(false);
    const [selectedBulkTag, setSelectedBulkTag] = useState<string | null>(null);
    const [showBulkTagDropdown, setShowBulkTagDropdown] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [zoomedPhoto, setZoomedPhoto] = useState<Photo | null>(null);
    const [favoritesLoaded, setFavoritesLoaded] = useState(false);

    // Detect mobile device
    useEffect(() => {
        const checkMobile = () => {
            const isMobileDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
            setIsMobile(isMobileDevice);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [nextToken, setNextToken] = useState<string | null>(null);
    const [isRequestInProgress, setIsRequestInProgress] = useState(false);

    // Refs for scroll handler to avoid stale closures and prevent frequent re-registration
    const hasMoreRef = useRef(hasMore);
    const loadingRef = useRef(loading);
    
    // Update refs when state changes
    useEffect(() => {
        hasMoreRef.current = hasMore;
    }, [hasMore]);
    
    useEffect(() => {
        loadingRef.current = loading;
    }, [loading]);

    const fetchPhotos = async (loadMore = false) => {
        if (loading || (!hasMore && loadMore) || isRequestInProgress) return;
        
        setLoading(true);
        setIsRequestInProgress(true);
        
        try {
            // Get Cognito ID token (required for API Gateway Cognito User Pool authorizer)
            const session = await fetchAuthSession();
            const idToken = session.tokens?.idToken?.toString();

            if (!idToken) {
                throw new Error("No ID token available - please sign out and sign back in");
            }

            let allPhotos: Photo[] = [];

            // Step 1: Load ALL favorites first (only on initial load)
            if (!loadMore && !favoritesLoaded) {
                try {
                    console.log("Loading all favorites first...");
                    const favoritesApiUrl = import.meta.env.VITE_API_URL.replace("/photos", "/favorites");
                    // Remove limit to get ALL favorites
                    const favoritesResponse = await fetch(favoritesApiUrl, {
                        headers: {
                            Authorization: `Bearer ${idToken}`,
                        },
                    });

                    if (favoritesResponse.ok) {
                        const favoritesData = await favoritesResponse.json();
                        const favoritePhotos = favoritesData.favorites || [];
                        console.log(`Loaded ${favoritePhotos.length} favorite photos (all favorites)`);
                        
                        // Mark as favorites and add to photos
                        const favoritesWithFlag = favoritePhotos.map((photo: Photo) => ({
                            ...photo,
                            isFavorite: true,
                        }));
                        
                        allPhotos = [...favoritesWithFlag];
                        setFavoritesLoaded(true);
                    } else {
                        console.warn("Failed to load favorites, continuing with regular photos");
                    }
                } catch (favErr) {
                    console.warn("Error loading favorites:", favErr);
                }
            }

            // Step 2: Load regular photos (with random starting point and backend filtering)
            let url = import.meta.env.VITE_API_URL;
            if (loadMore && nextToken) {
                const params = new URLSearchParams();
                params.append('limit', '25');
                params.append('nextToken', nextToken);
                url += '?' + params.toString();
            } else {
                // First load or no pagination - backend will start from random position
                url += `?limit=25`;
            }

            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Failed to fetch photos: ${response.status} ${text}`);
            }
              
            const data = await response.json();
            
            // Handle paginated response format
            const regularPhotos = data.photos || data;
            const pagination = data.pagination;
            
            if (pagination) {
                setNextToken(pagination.nextToken);
                setHasMore(pagination.hasMore && !!pagination.nextToken);
            } else {
                setHasMore(false);
            }
            
            console.log(`Loaded ${regularPhotos.length} regular photos`);
            
            // Mark favorites for regular photos and filter out any that are already in favorites
            const regularPhotosWithFavorites = regularPhotos.map((photo: Photo) => ({
                ...photo,
                isFavorite: photo.isFavorite || false,
            }));

            // If we have favorites loaded, filter out any regular photos that are already favorites
            let filteredRegularPhotos = regularPhotosWithFavorites;
            if (favoritesLoaded) {
                const favoriteKeys = new Set(allPhotos.filter((p: Photo) => p.isFavorite).map((p: Photo) => p.key));
                filteredRegularPhotos = regularPhotosWithFavorites.filter((photo: Photo) => !favoriteKeys.has(photo.key));
                console.log(`Filtered out ${regularPhotosWithFavorites.length - filteredRegularPhotos.length} photos that were already in favorites`);
            }

            // Combine favorites and regular photos
            allPhotos = [...allPhotos, ...filteredRegularPhotos];
            
            if (loadMore) {
                // Append to existing photos, but filter out duplicates
                setPhotos(prev => {
                    const existingKeys = new Set(prev.map((p: Photo) => p.key));
                    const newPhotos = allPhotos.filter(photo => !existingKeys.has(photo.key));
                    
                    console.log(`Loading more photos: ${prev.length} existing + ${newPhotos.length} new = ${prev.length + newPhotos.length} total`);
                    
                    return [...prev, ...newPhotos];
                });
            } else {
                // Replace photos (initial load) - all favorites are at the top
                setPhotos(allPhotos);
                const favoriteCount = allPhotos.filter(p => p.isFavorite).length;
                const regularCount = allPhotos.length - favoriteCount;
                console.log(`Initial load: ${allPhotos.length} total photos (${favoriteCount} favorites + ${regularCount} regular)`);
            }
            
            // Build favorites set
            const favSet = new Set<string>(allPhotos.filter((p: Photo) => p.isFavorite).map((p: Photo) => p.key));
            if (loadMore) {
                setFavorites(prev => new Set([...prev, ...favSet]));
            } else {
                setFavorites(favSet);
            }

            // Fetch tags for new photos
            await fetchAllTags(idToken, allPhotos);
        } catch (err: any) {
            console.error("Fetch photos error:", err);
            setError(err.message);
        } finally {
            setLoading(false);
            setIsRequestInProgress(false);
        }
    };

    useEffect(() => {
        fetchPhotos();
    }, []);

    // Infinite scroll effect
    useEffect(() => {
        let scrollTimeout: NodeJS.Timeout | null = null;
        
        const handleScroll = () => {
            // Throttle scroll events to prevent rapid-fire requests
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
            }
            
            scrollTimeout = setTimeout(() => {
                // Check if user is near bottom of page (within 1000px) or at the bottom
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                const windowHeight = window.innerHeight;
                const documentHeight = document.documentElement.scrollHeight;
                
                // More generous bottom detection - within 1000px OR within 10px of actual bottom
                const nearBottom = scrollTop + windowHeight >= documentHeight - 1000;
                const atBottom = scrollTop + windowHeight >= documentHeight - 10;
                
                if (nearBottom || atBottom) {
                    // User is near bottom or at bottom, load more photos
                    if (hasMoreRef.current && !loadingRef.current) {
                        console.log('Triggering fetchPhotos from scroll');
                        fetchPhotos(true);
                    }
                }
            }, 100); // 100ms throttle
        };

        // Add scroll listener
        window.addEventListener('scroll', handleScroll);
        
        // Cleanup
        return () => {
            window.removeEventListener('scroll', handleScroll);
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
            }
        };
    }, []); // No dependencies - refs handle state access, preventing frequent re-registration

    const fetchAllTags = async (idToken: string, photosList: Photo[]) => {
        const tagsMap = new Map<string, Set<string>>();
        
        console.log(`Fetching tags for ${photosList.length} photos`);
        
        for (const photo of photosList) {
            try {
                const apiUrl = import.meta.env.VITE_API_URL.replace("/photos", `/tags?photoKey=${encodeURIComponent(photo.key)}`);
                const response = await fetch(apiUrl, {
                    headers: {
                        Authorization: `Bearer ${idToken}`,
                    },
                });
                
                const tags = new Set<string>();
                
                if (response.ok) {
                    const data = await response.json();
                    const apiTags = data.tags?.map((t: { tag: string }) => t.tag) || [];
                    apiTags.forEach((tag: string) => tags.add(tag));
                } else {
                    console.warn(`Failed to fetch tags for ${photo.key}, status:`, response.status);
                }
                
                // Always add the photo to the map, even if it has no tags
                tagsMap.set(photo.key, tags);
                
            } catch (err) {
                console.error(`Failed to fetch tags for ${photo.key}`, err);
                
                // Even on error, add the photo to the map with empty tags
                const tags = new Set<string>();
                tagsMap.set(photo.key, tags);
            }
        }
        
        console.log(`Processed ${tagsMap.size} photos for tags`);
        
        setPhotoTags(prevTags => {
            const newTags = new Map(prevTags);
            console.log(`Merging tags: ${prevTags.size} existing + ${tagsMap.size} new`);
            tagsMap.forEach((tags, photoKey) => {
                newTags.set(photoKey, tags);
            });
            console.log(`Total tags after merge: ${newTags.size}`);
            return newTags;
        });
    };

    const toggleFavorite = async (photoKey: string) => {
        // Optimistically update UI first
        const isFavorite = favorites.has(photoKey);
        const newFavorites = new Set(favorites);
        if (isFavorite) {
            newFavorites.delete(photoKey);
        } else {
            newFavorites.add(photoKey);
        }
        setFavorites(newFavorites);

        try {
            const session = await fetchAuthSession();
            const idToken = session.tokens?.idToken?.toString();

            if (!idToken) {
                throw new Error("No ID token available");
            }

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

            // Success - UI is already updated optimistically
        } catch (err: any) {
            console.error(err);
            setError(err.message);
            
            // Revert the optimistic update on error
            setFavorites(favorites); // Restore original state
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

    const downloadPhoto = async (photoKey: string, photoUrl: string) => {
        try {
            // Fetch the image
            const response = await fetch(photoUrl);
            if (!response.ok) throw new Error('Failed to fetch image');
            
            // Get the image blob
            const blob = await response.blob();
            
            // Create download link
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            
            // Extract filename from photo key (remove path if present)
            const filename = photoKey.split('/').pop() || photoKey;
            link.download = filename;
            
            // Trigger download
            document.body.appendChild(link);
            link.click();
            
            // Cleanup
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Download failed:', error);
            alert('Failed to download photo. Please try again.');
        }
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

                // Step 3: Add "Uploaded" tag to the photo
                try {
                    const tagApiUrl = import.meta.env.VITE_API_URL.replace("/photos", "/tags");
                    const tagResponse = await fetch(tagApiUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${idToken}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ 
                            photoKey: key, 
                            tag: 'Uploaded' 
                        }),
                    });

                    if (!tagResponse.ok) {
                        console.warn(`Failed to add Uploaded tag to ${key}`);
                    }
                } catch (tagError) {
                    console.warn(`Failed to tag uploaded photo ${key}:`, tagError);
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
                        
                        const photosWithFavorites = filteredPhotos.map((photo: Photo) => ({
                            ...photo,
                            isFavorite: photo.isFavorite || false,
                        }));
                        
                        // Simple sort by photo key (no automated year/month sorting)
                        photosWithFavorites.sort((a: Photo, b: Photo) => {
                            // 1. Sort by favorite count (higher counts first)
                            const aFavCount = a.favoriteCount || 0;
                            const bFavCount = b.favoriteCount || 0;
                            if (aFavCount !== bFavCount) {
                                return bFavCount - aFavCount;
                            }
                            
                            // 2. Sort by photo key as tiebreaker
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

    const checkForDuplicateNames = (files: File[]): { duplicates: string[], validFiles: File[] } => {
        const existingNames = new Set(photos.map(photo => {
            // Extract just the filename from the photo key
            const filename = photo.key.split('/').pop() || photo.key;
            // Remove timestamp and user ID prefix if present (e.g., "1765511834546_28018300_filename.jpg" -> "filename.jpg")
            return filename.replace(/^\d+_\d+_/, '');
        }));
        
        const duplicates: string[] = [];
        const validFiles: File[] = [];
        
        files.forEach(file => {
            if (existingNames.has(file.name)) {
                duplicates.push(file.name);
            } else {
                validFiles.push(file);
            }
        });
        
        return { duplicates, validFiles };
    };

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (files && files.length > 0) {
            const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
            const validFiles: File[] = [];
            const invalidFiles: string[] = [];
            
            // Validate file types
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
            
            // Check for duplicate names
            const { duplicates, validFiles: nonDuplicateFiles } = checkForDuplicateNames(validFiles);
            
            if (duplicates.length > 0) {
                const proceed = confirm(
                    `The following files have names that already exist:\n\n${duplicates.join('\n')}\n\n` +
                    `Please rename these files and try again, or click OK to upload only the files without conflicts (${nonDuplicateFiles.length} files).`
                );
                
                if (!proceed) {
                    // Reset the input
                    event.target.value = '';
                    return;
                }
                
                if (nonDuplicateFiles.length === 0) {
                    setError('All selected files have duplicate names. Please rename them and try again.');
                    event.target.value = '';
                    return;
                }
                
                // Upload only non-duplicate files
                setError(null);
                uploadMultiplePhotos(nonDuplicateFiles);
            } else if (validFiles.length > 0) {
                // No duplicates, upload all files
                setError(null);
                uploadMultiplePhotos(validFiles);
            }
        }
        
        // Reset the input so the same files can be selected again
        event.target.value = '';
    };

    // Count how many photos have each tag
    const getTagCount = (tag: string) => {
        return photos.filter(photo => {
            const tags = photoTags.get(photo.key) || new Set<string>();
            return tags.has(tag);
        }).length;
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
            style={{ 
                padding: "1rem",
                backgroundColor: "#1a1a1a",
                color: "#ffffff",
                minHeight: "100vh"
            }}
            onClick={() => {
                setContextMenu(null);
                setShowYearDropdown(false);
                setShowMonthDropdown(false);
                setShowBulkTagDropdown(false);
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
                    
                    {/* Bulk Tag Mode Button */}
                    <div style={{ position: "relative" }}>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (bulkTagMode) {
                                    // Exit bulk tag mode
                                    setBulkTagMode(false);
                                    setSelectedBulkTag(null);
                                    setShowBulkTagDropdown(false);
                                } else {
                                    // Enter bulk tag mode
                                    setBulkTagMode(true);
                                    setShowBulkTagDropdown(true);
                                }
                            }}
                            style={{
                                padding: "8px 16px",
                                backgroundColor: bulkTagMode ? "#dc3545" : "#6f42c1",
                                color: "white",
                                border: "none",
                                borderRadius: "4px",
                                cursor: "pointer",
                                fontSize: "0.9rem",
                                fontWeight: "bold",
                                display: "inline-block",
                                marginRight: "12px",
                            }}
                        >
                            {bulkTagMode ? "Exit Tag Mode" : "🏷️ Tag Multiple Photos"}
                        </button>
                        
                        {/* Bulk Tag Selection Dropdown */}
                        {showBulkTagDropdown && (
                            <div
                                style={{
                                    position: "absolute",
                                    top: "100%",
                                    left: 0,
                                    backgroundColor: "white",
                                    border: "2px solid #6f42c1",
                                    borderRadius: "4px",
                                    boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
                                    zIndex: 9999,
                                    minWidth: "250px",
                                    maxHeight: "300px",
                                    overflowY: "auto",
                                    marginTop: "4px",
                                }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div style={{ padding: "8px 12px", fontSize: "0.8rem", color: "#666", borderBottom: "1px solid #eee", backgroundColor: "#f8f9fa" }}>
                                    Select a tag to apply ({availableTags.length} tags):
                                </div>
                                {availableTags.map((tag: string) => (
                                    <button
                                        key={tag}
                                        onClick={() => {
                                            setSelectedBulkTag(tag);
                                            setShowBulkTagDropdown(false);
                                        }}
                                        style={{
                                            display: "block",
                                            width: "100%",
                                            padding: "8px 12px",
                                            border: "none",
                                            background: selectedBulkTag === tag ? "#f0e6ff" : "transparent",
                                            textAlign: "left",
                                            cursor: "pointer",
                                            fontSize: "0.9rem",
                                        }}
                                        onMouseEnter={(e) => {
                                            if (selectedBulkTag !== tag) {
                                                e.currentTarget.style.backgroundColor = "#f8f9fa";
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (selectedBulkTag !== tag) {
                                                e.currentTarget.style.backgroundColor = "transparent";
                                            }
                                        }}
                                    >
                                        {tag}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>




                    <button onClick={signOut}>Sign Out</button>
                </div>
            </div>

            {/* Description Section */}
            <div style={{
                marginBottom: "1.5rem",
                padding: "16px 20px",
                backgroundColor: "#f8f9fa",
                borderRadius: "8px",
                border: "1px solid #e9ecef",
                fontSize: "0.9rem",
                lineHeight: "1.5",
                color: "#495057"
            }}>
                <div style={{ marginBottom: "12px" }}>
                    <strong style={{ color: "#007bff" }}>Welcome to your Family Shared Photo Album! </strong> 
                    Browse through years of memories - here is a brief description of what you can do:
                </div>
                
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px" }}>
                    <div>
                        <strong>📸 Viewing:</strong> Click any photo for a zoomed view, or scroll down to load more memories
                    </div>
                    <div>
                        <strong>❤️ Favorites:</strong> Right-click photos to favorite them - hearts show how many people liked each photo
                    </div>
                    <div>
                        <strong>🏷️ Tagging:</strong> Right-click to tag photos, or use "Tag Multiple Photos" mode for bulk tagging
                    </div>
                    <div>
                        <strong>📥 Download:</strong> Right-click any photo to save it to your computer or tap and long press on mobile
                    </div>
                    <div>
                        <strong>📤 Upload:</strong> Share your own photos using the upload button above
                    </div>
                    <div>
                        <strong>🔄 Sync:</strong> Refresh the page to load new photos and save your favorites!
                    </div>
                </div>
            </div>

            {/* Bulk Tag Mode Status */}
            {bulkTagMode && selectedBulkTag && (
                <div style={{
                    marginBottom: "1rem",
                    padding: "12px 16px",
                    backgroundColor: "#f0e6ff",
                    border: "2px solid #6f42c1",
                    borderRadius: "8px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between"
                }}>
                    <div>
                        <strong style={{ color: "#6f42c1" }}>🏷️ Bulk Tag Mode Active</strong>
                        <div style={{ fontSize: "0.9rem", color: "#666", marginTop: "4px" }}>
                            Click any photo to add the tag: <strong style={{ color: "#6f42c1" }}>{selectedBulkTag}</strong>
                        </div>
                    </div>
                    <button
                        onClick={() => {
                            setBulkTagMode(false);
                            setSelectedBulkTag(null);
                            setShowBulkTagDropdown(false);
                        }}
                        style={{
                            padding: "6px 12px",
                            backgroundColor: "#dc3545",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "0.8rem"
                        }}
                    >
                        Exit
                    </button>
                </div>
            )}

            {/* Upload Progress */}
            {uploading && (
                <div style={{ 
                    marginBottom: "1rem", 
                    padding: "16px", 
                    backgroundColor: "#f8f9fa", 
                    borderRadius: "8px",
                    border: "1px solid #e9ecef"
                }}>
                    <div style={{ 
                        display: "flex", 
                        justifyContent: "space-between", 
                        alignItems: "center", 
                        marginBottom: "8px" 
                    }}>
                        <span style={{ 
                            fontSize: "0.9rem", 
                            fontWeight: "600", 
                            color: "#495057" 
                        }}>
                            {uploadProgress || "Uploading photos..."}
                        </span>
                        <span style={{ 
                            fontSize: "0.8rem", 
                            color: "#6c757d" 
                        }}>
                            {uploadQueue.completed + uploadQueue.failed} / {uploadQueue.total}
                        </span>
                    </div>
                    
                    {/* Progress Bar */}
                    <div style={{
                        width: "100%",
                        height: "8px",
                        backgroundColor: "#e9ecef",
                        borderRadius: "4px",
                        overflow: "hidden",
                        marginBottom: "8px"
                    }}>
                        <div style={{
                            height: "100%",
                            backgroundColor: uploadQueue.failed > 0 ? "#ffc107" : "#28a745",
                            borderRadius: "4px",
                            width: `${uploadQueue.total > 0 ? ((uploadQueue.completed + uploadQueue.failed) / uploadQueue.total) * 100 : 0}%`,
                            transition: "width 0.3s ease-in-out"
                        }} />
                    </div>
                    
                    {/* Status Details */}
                    <div style={{ 
                        display: "flex", 
                        gap: "16px", 
                        fontSize: "0.75rem", 
                        color: "#6c757d" 
                    }}>
                        {uploadQueue.completed > 0 && (
                            <span style={{ color: "#28a745" }}>
                                ✓ {uploadQueue.completed} completed
                            </span>
                        )}
                        {uploadQueue.failed > 0 && (
                            <span style={{ color: "#dc3545" }}>
                                ✗ {uploadQueue.failed} failed
                            </span>
                        )}
                        {uploadQueue.total - uploadQueue.completed - uploadQueue.failed > 0 && (
                            <span style={{ color: "#007bff" }}>
                                ⏳ {uploadQueue.total - uploadQueue.completed - uploadQueue.failed} pending
                            </span>
                        )}
                    </div>
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
                                        <span style={{ fontWeight: "bold", color: "#155724" }}>
                                            {year} ({getTagCount(year)})
                                        </span>
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
                                        <span style={{ fontWeight: "bold", color: "#0056b3" }}>
                                            {month} ({getTagCount(month)})
                                        </span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                
                {/* Regular Tags Section */}
                <span style={{ fontWeight: "bold" }}>People & Tags:</span>
                {availableTags.map((tag: string) => {
                    const count = getTagCount(tag);
                    return (
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
                            {tag} ({count})
                        </button>
                    );
                })}
            </div>

            {error && <p style={{ color: "red" }}>Error: {error}</p>}
            {!error && filteredPhotos.length === 0 && loading && <p>Loading photos...</p>}
            {!error && filteredPhotos.length === 0 && !loading && <p>No photos found.</p>}
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
                                if (!bulkTagMode) {
                                    e.preventDefault();
                                    setContextMenu({ x: e.clientX, y: e.clientY, photoKey: photo.key });
                                }
                            }}
                            onClick={async (e) => {
                                if (bulkTagMode && selectedBulkTag) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    await toggleTag(photo.key, selectedBulkTag);
                                } else {
                                    // Show zoomed view
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setZoomedPhoto(photo);
                                }
                            }}
                            style={{ 
                                cursor: bulkTagMode && selectedBulkTag ? "crosshair" : "pointer", 
                                position: "relative",
                                border: bulkTagMode && selectedBulkTag ? "2px dashed #6f42c1" : "none",
                                borderRadius: "8px",
                                padding: bulkTagMode && selectedBulkTag ? "2px" : "0",
                                // Prevent iOS image saving and context menu
                                WebkitTouchCallout: "none",
                                WebkitUserSelect: "none",
                                userSelect: "none"
                            } as React.CSSProperties}
                        >
                            <div style={{ position: "relative" }}>
                                <img
                                    src={photo.url}
                                    alt={photo.key}
                                    style={{
                                        width: "100%",
                                        borderRadius: "8px",
                                        border: favorites.has(photo.key) ? "4px solid gold" : "none",
                                        maxWidth: "100%",
                                        height: "auto",
                                    }}
                                    loading="lazy"
                                    onError={() => {
                                        console.error("Image load error:", photo.key);
                                    }}
                                />
                                
                                {/* Mobile Menu Button - Only visible on touch devices */}
                                {isMobile && (
                                    <button
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setContextMenu({ x: e.clientX, y: e.clientY, photoKey: photo.key });
                                        }}
                                        style={{
                                            position: "absolute",
                                            top: "8px",
                                            right: "8px",
                                            width: "32px",
                                            height: "32px",
                                            borderRadius: "50%",
                                            backgroundColor: "rgba(0, 0, 0, 0.7)",
                                            color: "white",
                                            border: "none",
                                            cursor: "pointer",
                                            fontSize: "16px",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            zIndex: 10,
                                            fontWeight: "bold"
                                        }}
                                        onTouchStart={(e) => {
                                            e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.9)";
                                        }}
                                        onTouchEnd={(e) => {
                                            e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
                                        }}
                                    >
                                        ⋮
                                    </button>
                                )}
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

            {/* Loading indicator for infinite scroll */}
            {loading && (
                <div style={{ textAlign: "center", margin: "20px 0" }}>
                    <p>Loading more photos...</p>
                </div>
            )}

            {/* End of photos indicator */}
            {!hasMore && photos.length > 0 && (
                <div style={{ textAlign: "center", margin: "20px 0", color: "#666" }}>
                    <p>You've reached the end of your photos!</p>
                </div>
            )}

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
                    {!isMobile && (
                        <button
                            onClick={() => {
                                const photo = photos.find(p => p.key === contextMenu.photoKey);
                                if (photo) {
                                    downloadPhoto(contextMenu.photoKey, photo.url);
                                }
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
                            Download Photo
                        </button>
                    )}
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
                            minWidth: isMobile ? "90vw" : "500px",
                            maxWidth: isMobile ? "95vw" : "600px",
                            maxHeight: isMobile ? "80vh" : "auto",
                            overflowY: isMobile ? "auto" : "visible",
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 style={{ marginTop: 0 }}>Select Tags</h3>
                        
                        <div style={{ 
                            display: "flex", 
                            flexDirection: isMobile ? "column" : "row",
                            gap: "16px", 
                            maxHeight: isMobile ? "none" : "400px", 
                            overflowY: isMobile ? "visible" : "auto" 
                        }}>
                            {/* People & Names Column */}
                            <div style={{ flex: 1, minWidth: isMobile ? "auto" : "150px" }}>
                                <h4 style={{ margin: "0 0 8px 0", fontSize: "0.9rem", color: "#666", borderBottom: "1px solid #eee", paddingBottom: "4px" }}>
                                    People & Names
                                </h4>
                                <div style={{ 
                                    display: "flex", 
                                    flexDirection: "column", 
                                    gap: "4px",
                                    maxHeight: isMobile ? "200px" : "none",
                                    overflowY: isMobile ? "auto" : "visible"
                                }}>
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
                            <div style={{ flex: 1, minWidth: isMobile ? "auto" : "120px" }}>
                                <h4 style={{ margin: "0 0 8px 0", fontSize: "0.9rem", color: "#666", borderBottom: "1px solid #eee", paddingBottom: "4px" }}>
                                    Years
                                </h4>
                                <div style={{ 
                                    display: "flex", 
                                    flexDirection: "column", 
                                    gap: "4px", 
                                    maxHeight: isMobile ? "200px" : "350px", 
                                    overflowY: "auto" 
                                }}>
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
                            <div style={{ flex: 1, minWidth: isMobile ? "auto" : "120px" }}>
                                <h4 style={{ margin: "0 0 8px 0", fontSize: "0.9rem", color: "#666", borderBottom: "1px solid #eee", paddingBottom: "4px" }}>
                                    Months
                                </h4>
                                <div style={{ 
                                    display: "flex", 
                                    flexDirection: "column", 
                                    gap: "4px",
                                    maxHeight: isMobile ? "200px" : "none",
                                    overflowY: isMobile ? "auto" : "visible"
                                }}>
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

            {/* Zoom Modal */}
            {zoomedPhoto && (
                <div
                    style={{
                        position: "fixed",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: "rgba(0,0,0,0.9)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 3000,
                        padding: "20px",
                    }}
                    onClick={() => setZoomedPhoto(null)}
                >
                    <div
                        style={{
                            position: "relative",
                            maxWidth: "90vw",
                            maxHeight: "90vh",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Close button */}
                        <button
                            onClick={() => setZoomedPhoto(null)}
                            style={{
                                position: "absolute",
                                top: "-10px",
                                right: "-10px",
                                width: "40px",
                                height: "40px",
                                borderRadius: "50%",
                                backgroundColor: "rgba(255, 255, 255, 0.9)",
                                color: "black",
                                border: "none",
                                cursor: "pointer",
                                fontSize: "20px",
                                fontWeight: "bold",
                                zIndex: 3001,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            ×
                        </button>
                        
                        {/* Zoomed image */}
                        <img
                            src={zoomedPhoto.url}
                            alt={zoomedPhoto.key}
                            style={{
                                maxWidth: "100%",
                                maxHeight: "80vh",
                                objectFit: "contain",
                                borderRadius: "8px",
                                boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
                            }}
                        />
                        
                        {/* Photo info */}
                        <div
                            style={{
                                marginTop: "16px",
                                padding: "12px 16px",
                                backgroundColor: "rgba(255, 255, 255, 0.9)",
                                borderRadius: "8px",
                                maxWidth: "100%",
                                textAlign: "center",
                            }}
                        >
                            <p style={{ 
                                margin: "0 0 8px 0", 
                                fontSize: "0.9rem", 
                                wordWrap: "break-word",
                                color: "black"
                            }}>
                                {zoomedPhoto.key}
                            </p>
                            
                            {/* Show tags if any */}
                            {photoTags.get(zoomedPhoto.key) && photoTags.get(zoomedPhoto.key)!.size > 0 && (
                                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", justifyContent: "center" }}>
                                    {Array.from(photoTags.get(zoomedPhoto.key)!).map((tag) => {
                                        const isYearTag = /^(19\d{2}|20\d{2})$/.test(tag);
                                        const isMonthTag = ["January", "February", "March", "April", "May", "June",
                                            "July", "August", "September", "October", "November", "December"].includes(tag);
                                        const isBaseTag = BASE_TAGS.includes(tag);
                                        const isUserTag = !isBaseTag && !isYearTag && !isMonthTag;
                                        
                                        let backgroundColor = "#e6ccff";
                                        let color = "#6f42c1";
                                        
                                        if (isYearTag) {
                                            backgroundColor = "#d4edda";
                                            color = "#155724";
                                        } else if (isMonthTag) {
                                            backgroundColor = "#cce7ff";
                                            color = "#0056b3";
                                        } else if (isUserTag) {
                                            backgroundColor = "#ffc0cb";
                                            color = "#8b008b";
                                        }
                                        
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
                            
                            {/* Show favorite count if > 0 */}
                            {zoomedPhoto.favoriteCount !== undefined && zoomedPhoto.favoriteCount > 0 && (
                                <div style={{ 
                                    marginTop: "8px", 
                                    fontSize: "0.9rem", 
                                    color: "#dc3545",
                                    fontWeight: "bold"
                                }}>
                                    ❤️ {zoomedPhoto.favoriteCount} favorites
                                </div>
                            )}
                            
                            {/* Mobile save instruction */}
                            {isMobile && (
                                <div style={{ 
                                    marginTop: "8px", 
                                    fontSize: "0.8rem", 
                                    color: "#666",
                                    fontStyle: "italic",
                                    padding: "4px 8px",
                                    backgroundColor: "rgba(0,0,0,0.1)",
                                    borderRadius: "4px"
                                }}>
                                    💡 Long-press the image above to save to your photo album
                                </div>
                            )}
                        </div>
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

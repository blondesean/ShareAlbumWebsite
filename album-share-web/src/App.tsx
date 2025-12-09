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
}

const AVAILABLE_TAGS = import.meta.env.VITE_AVAILABLE_TAGS?.split(",") || ["Jeff", "Sean", "Karen"];

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

    useEffect(() => {
        async function fetchPhotos() {
            try {
                console.log("API URL:", import.meta.env.VITE_API_URL);

                // Get Cognito ID token
                const session = await fetchAuthSession();
                const idToken = session.tokens?.idToken?.toString();

                if (!idToken) {
                    throw new Error("No authentication token available");
                }

                const response = await fetch(import.meta.env.VITE_API_URL, {
                    headers: {
                        Authorization: `Bearer ${idToken}`,
                    },
                });

                if (!response.ok) throw new Error("Failed to fetch photos");
                const data = await response.json();
                
                // Filter to only show photos containing "_a.jpg"
                const filteredPhotos = data.filter((photo: Photo) => photo.key.includes("_a.jpg"));
                
                // Mark favorites and sort (favorites first)
                const photosWithFavorites = filteredPhotos.map((photo: Photo) => ({
                    ...photo,
                    isFavorite: photo.isFavorite || false,
                }));
                
                // Sort: favorites first, then by key
                photosWithFavorites.sort((a: Photo, b: Photo) => {
                    if (a.isFavorite && !b.isFavorite) return -1;
                    if (!a.isFavorite && b.isFavorite) return 1;
                    return 0;
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
                console.log("Fetching tags from:", apiUrl);
                const response = await fetch(apiUrl, {
                    headers: {
                        Authorization: `Bearer ${idToken}`,
                    },
                });
                
                if (response.ok) {
                    const data = await response.json();
                    console.log(`Tags for ${photo.key}:`, data);
                    const tags = new Set<string>(data.tags?.map((t: { tag: string }) => t.tag) || []);
                    if (tags.size > 0) {
                        tagsMap.set(photo.key, tags);
                    }
                } else {
                    console.warn(`Failed to fetch tags for ${photo.key}, status:`, response.status);
                }
            } catch (err) {
                console.error(`Failed to fetch tags for ${photo.key}`, err);
            }
        }
        
        console.log("Final tags map:", tagsMap);
        setPhotoTags(tagsMap);
    };

    const toggleFavorite = async (photoKey: string) => {
        try {
            const session = await fetchAuthSession();
            const idToken = session.tokens?.idToken?.toString();

            if (!idToken) {
                throw new Error("No authentication token available");
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
                throw new Error("No authentication token available");
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

    const requestNewTag = async () => {
        if (!requestedTag.trim()) return;
        
        try {
            const session = await fetchAuthSession();
            const idToken = session.tokens?.idToken?.toString();

            if (!idToken) {
                throw new Error("No authentication token available");
            }

            // You can implement a backend endpoint for tag requests
            // For now, just log it or send to a simple endpoint
            console.log("Tag requested:", requestedTag);
            alert(`Tag request submitted: "${requestedTag}"\n\nAn admin will review your request.`);
            
            setRequestedTag("");
            setShowTagRequest(false);
        } catch (err: any) {
            console.error(err);
            setError(err.message);
        }
    };

    const filteredPhotos = selectedFilter
        ? photos.filter((photo) => photoTags.get(photo.key)?.has(selectedFilter))
        : photos;

    return (
        <div
            style={{ padding: "1rem" }}
            onClick={() => setContextMenu(null)}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h1>Family Album</h1>
                <button onClick={signOut}>Sign Out</button>
            </div>

            {/* Tag Filter */}
            <div style={{ marginBottom: "1rem", display: "flex", gap: "8px", alignItems: "center" }}>
                <span>Filter by tag:</span>
                <button
                    onClick={() => setSelectedFilter(null)}
                    style={{
                        padding: "6px 12px",
                        border: "1px solid #ccc",
                        borderRadius: "4px",
                        background: selectedFilter === null ? "#007bff" : "white",
                        color: selectedFilter === null ? "white" : "black",
                        cursor: "pointer",
                    }}
                >
                    All
                </button>
                {AVAILABLE_TAGS.map((tag: string) => (
                    <button
                        key={tag}
                        onClick={() => setSelectedFilter(tag)}
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
                            style={{ cursor: "pointer" }}
                        >
                            <img
                                src={photo.url}
                                alt={photo.key}
                                style={{
                                    width: "100%",
                                    borderRadius: "8px",
                                    border: favorites.has(photo.key) ? "4px solid gold" : "none",
                                }}
                            />
                            <p style={{ fontSize: "0.9rem" }}>{photo.key}</p>
                            {tags.size > 0 && (
                                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "4px" }}>
                                    {Array.from(tags).map((tag) => (
                                        <span
                                            key={tag}
                                            style={{
                                                fontSize: "0.75rem",
                                                padding: "2px 6px",
                                                backgroundColor: "#e0e0e0",
                                                borderRadius: "4px",
                                            }}
                                        >
                                            {tag}
                                        </span>
                                    ))}
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
                            minWidth: "300px",
                            maxWidth: "400px",
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 style={{ marginTop: 0 }}>Select Tags</h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto" }}>
                            {AVAILABLE_TAGS.map((tag: string) => {
                                const isSelected = photoTags.get(tagModal.photoKey)?.has(tag) || false;
                                return (
                                    <label
                                        key={tag}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px",
                                            padding: "8px",
                                            cursor: "pointer",
                                            borderRadius: "4px",
                                            backgroundColor: isSelected ? "#e3f2fd" : "transparent",
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleTag(tagModal.photoKey, tag)}
                                            style={{ cursor: "pointer" }}
                                        />
                                        <span>{tag}</span>
                                    </label>
                                );
                            })}
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
                                + Request New Tag
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
                                        if (e.key === "Enter") requestNewTag();
                                        if (e.key === "Escape") {
                                            setShowTagRequest(false);
                                            setRequestedTag("");
                                        }
                                    }}
                                />
                                <div style={{ display: "flex", gap: "8px" }}>
                                    <button
                                        onClick={requestNewTag}
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
                                        Submit
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

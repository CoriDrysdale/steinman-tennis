"use client"; // Add this line at the very top of the file

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, getDocs, query, onSnapshot, serverTimestamp, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { getAnalytics, logEvent } from 'firebase/analytics'; // Import Analytics SDK

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Default Firebase configuration for local development.
// IMPORTANT: Replace these placeholder values with your actual Firebase project configuration
// when running the app locally outside of the Canvas environment.
const defaultFirebaseConfig = {
  apiKey: "AIzaSyDeJgR3UB4pTp6HChBytGlrdc1ej1kV7kc",
  authDomain: "steinman-tennis.firebaseapp.com",
  projectId: "steinman-tennis",
  storageBucket: "steinman-tennis.firebasestorage.app",
  messagingSenderId: "590586540046",
  appId: "1:590586540046:web:264ab89a69bc11ed314c5f",
  measurementId: "G-5M5NKM84SE" // Make sure this is present for Analytics
};

// Determine Firebase configuration to use: prioritize Canvas globals, else use default.
let firebaseConfigToUse = { ...defaultFirebaseConfig };
if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    try {
        const canvasConfig = JSON.parse(__firebase_config);
        // Merge canvas config over defaults, allowing Canvas to override local settings
        firebaseConfigToUse = { ...firebaseConfigToUse, ...canvasConfig };
    } catch (e) {
        console.error("Error parsing __firebase_config from Canvas, using default:", e);
    }
}

// Explicitly set appId from __app_id if it's provided by Canvas, as it might be more precise.
const resolvedAppId = typeof __app_id !== 'undefined' ? __app_id : firebaseConfigToUse.appId;
if (resolvedAppId) {
    firebaseConfigToUse.appId = resolvedAppId;
}

// Determine Gemini API Key: prioritize Canvas global if present, else use the real Gemini API key (different from the Firebase API key)
const geminiApiKey = typeof __api_key !== 'undefined' ? __api_key : 'AIzaSyCCjpPj4Nz8b24xrYN69Fc36SLhJZc2dDg';


// The initial authentication token provided by the Canvas environment.
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Initialize Firebase (will be initialized in useEffect)
let firebaseAppInstance;
let firestoreDbInstance;
let firebaseAuthInstance;
let firebaseAnalyticsInstance; // Declare a variable for Analytics instance


// Main App Component
const App = () => {
    // State variables for Firebase and user data
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false); // Tracks when Firebase Auth is ready

    // Tournament Configuration States
    const [totalPlayersCount, setTotalPlayersCount] = useState(20);
    const [courtsPerDayCount, setCourtsPerDayCount] = useState(5);
    const [tournamentDurationDays, setTournamentDurationDays] = useState(18);

    // Score Configuration States
    const [gamesToWinSet, setGamesToWinSet] = useState(6); // e.g., win by 6 games
    const [setsToWinMatch, setSetsToWinMatch] = useState(2); // e.g., best of 3, so first to 2 sets
    const [tiebreakerScoreThreshold, setTiebreakerScoreThreshold] = useState(6); // e.g., tiebreaker at 6-6
    const [tiebreakerPointsToWin, setTiebreakerPointsToWin] = useState(7); // e.g., win tiebreaker by 7 points
    const [tiebreakerMinWinDifference, setTiebreakerMinWinDifference] = useState(2); // e.g., win tiebreaker by 2 points difference

    // State for player input and management - now includes handicap
    // playerInputs will dynamically adjust size based on totalPlayersCount
    const [playerInputs, setPlayerInputs] = useState(Array(20).fill({ name: '', handicap: '' }));
    const [players, setPlayers] = useState([]); // Stored player data from Firebase (includes handicap)

    // Substitute Players
    const [substitutePlayers, setSubstitutePlayers] = useState([]);
    const [newSubstituteName, setNewSubstituteName] = useState('');
    const [newSubstituteHandicap, setNewSubstituteHandicap] = useState('');

    const [teams, setTeams] = useState([]); // Stored team data from Firebase (includes combined handicap)
    const [matches, setMatches] = useState([]); // Stored match data from Firebase
    const [filteredMatches, setFilteredMatches] = useState([]); // Matches filtered by 'Show My Matches Only'

    // State for UI messages and loading
    // Changed message to an object to include type
    const [message, setMessage] = useState({ text: null, type: null }); // { text: "...", type: "success" | "error" | "info" | "analysis" }
    const [loadingData, setLoadingData] = useState(true);
    const [analyzingMatchId, setAnalyzingMatchId] = useState(null); // Track which match is being analyzed for loading state
    const [gettingTournamentInsights, setGettingTournamentInsights] = useState(false); // Track loading for tournament insights
    const [analyzingPlayerId, setAnalyzingPlayerId] = useState(null); // Track loading for individual player insights
    const [gettingOptimalPairings, setGettingOptimalPairings] = useState(false); // Track loading for optimal pairings

    // States for confirmation modals
    const [showClearDataConfirm, setShowClearDataConfirm] = useState(false);
    const [matchToCancel, setMatchToCancel] = useState(null); // Stores the ID of the match to be cancelled

    // States for substitution modal
    const [showSubstituteModal, setShowSubstituteModal] = useState(false);
    const [selectedMatchForSubstitution, setSelectedMatchForSubstitution] = useState(null);
    const [playerToSubstituteKey, setPlayerToSubstituteKey] = useState(''); // 'team1_player1', 'team1_player2', 'team2_player1', 'team2_player2'
    const [selectedSubstituteId, setSelectedSubstituteId] = useState('');

    // State for score entry modal
    const [showScoreEntryModal, setShowScoreEntryModal] = useState(false);
    const [matchForScoreEntry, setMatchForScoreEntry] = useState(null);

    // State for filtering matches
    const [showMyMatchesOnly, setShowMyMatchesOnly] = useState(false);

    // Ref to prevent multiple Firebase initializations
    const isFirebaseInitialized = useRef(false);

    // Memoized value for number of teams, derived from totalPlayersCount
    const numberOfTeams = useMemo(() => totalPlayersCount / 2, [totalPlayersCount]);
    const isTotalPlayersEven = totalPlayersCount % 2 === 0;

    // --- Helper function to set message and scroll to top ---
    const setMessageAndScroll = (msg) => {
        setMessage(msg);
        // Only scroll to top if it's not a success message
        if (msg.type !== null && msg.type !== 'success') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    // --- Firebase Initialization and Authentication ---
    useEffect(() => {
        if (isFirebaseInitialized.current) {
            return;
        }

        try {
            firebaseAppInstance = initializeApp(firebaseConfigToUse);
            firestoreDbInstance = getFirestore(firebaseAppInstance);
            firebaseAuthInstance = getAuth(firebaseAppInstance);

            // Initialize Analytics only on the client side if measurementId is provided
            if (typeof window !== 'undefined' && firebaseConfigToUse.measurementId) {
                firebaseAnalyticsInstance = getAnalytics(firebaseAppInstance);
                console.log("Firebase Analytics initialized.");
            } else {
                console.warn("Firebase Analytics not initialized. `window` is not defined or `measurementId` is missing.");
            }

            setDb(firestoreDbInstance);
            setAuth(firebaseAuthInstance);

            const unsubscribe = onAuthStateChanged(firebaseAuthInstance, async (user) => {
                if (user) {
                    setUserId(user.uid);
                    setIsAuthReady(true);
                    console.log('User signed in:', user.uid);
                } else {
                    try {
                        if (initialAuthToken) {
                            await signInWithCustomToken(firebaseAuthInstance, initialAuthToken);
                            console.log('Signed in with custom token.');
                        } else {
                            await signInAnonymously(firebaseAuthInstance);
                            console.log('Signed in anonymously.');
                        }
                    } catch (error) {
                        console.error('Firebase Auth error:', error);
                        // Fallback to random ID if authentication fails, but still mark ready
                        setUserId(crypto.randomUUID());
                        setIsAuthReady(true);
                        setMessageAndScroll({ text: "Error initializing authentication. Functionality might be limited.", type: "error" });
                    }
                }
            });

            isFirebaseInitialized.current = true;
            return () => unsubscribe();
        } catch (error) {
            console.error("Error initializing Firebase:", error);
            setMessageAndScroll({ text: "Error initializing app. Please try again.", type: "error" });
            setUserId(crypto.randomUUID());
            setIsAuthReady(true);
        }
    }, []);

    // Function to log analytics events
    const logAnalyticsEvent = (eventName, eventParams = {}) => {
        if (firebaseAnalyticsInstance) {
            logEvent(firebaseAnalyticsInstance, eventName, eventParams);
            console.log(`Analytics Event Logged: ${eventName}`, eventParams);
        } else {
            console.warn("Firebase Analytics not initialized, cannot log event:", eventName);
        }
    };


    // --- Fetch initial data (players, teams, matches, substitutes) from Firebase ---
    useEffect(() => {
        if (!db || !userId || !isAuthReady) {
            console.log("Not ready to fetch data:", { db, userId, isAuthReady });
            return;
        }

        const fetchAllData = async () => {
            setLoadingData(true);
            try {
                // Listen to Players
                const playersColRef = collection(db, `artifacts/${resolvedAppId}/public/data/players`); // Use resolvedAppId
                const unsubscribePlayers = onSnapshot(playersColRef, (snapshot) => {
                    const fetchedPlayers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    setPlayers(fetchedPlayers);
                    // Dynamically set playerInputs size based on fetched players or default totalPlayersCount
                    const newPlayerInputs = Array(totalPlayersCount).fill({ name: '', handicap: '' });
                    fetchedPlayers.forEach((p, i) => {
                        if (i < totalPlayersCount) { // Only update if within current totalPlayersCount
                            newPlayerInputs[i] = { name: p.name, handicap: p.handicap || '' };
                        }
                    });
                    setPlayerInputs(newPlayerInputs);
                }, (error) => console.error("Error fetching players:", error));

                // Listen to Substitute Players
                const substitutesColRef = collection(db, `artifacts/${resolvedAppId}/public/data/substitutePlayers`); // Use resolvedAppId
                const unsubscribeSubstitutes = onSnapshot(substitutesColRef, (snapshot) => {
                    const fetchedSubstitutes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    setSubstitutePlayers(fetchedSubstitutes);
                }, (error) => console.error("Error fetching substitutes:", error));


                // Listen to Teams
                const teamsColRef = collection(db, `artifacts/${resolvedAppId}/public/data/teams`); // Use resolvedAppId
                const unsubscribeTeams = onSnapshot(teamsColRef, (snapshot) => {
                    const fetchedTeams = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    setTeams(fetchedTeams);
                }, (error) => console.error("Error fetching teams:", error));

                // Listen to Matches
                const matchesColRef = collection(db, `artifacts/${resolvedAppId}/public/data/matches`); // Use resolvedAppId
                const unsubscribeMatches = onSnapshot(matchesColRef, (snapshot) => {
                    let fetchedMatches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    // Sort matches by date, then time for display
                    fetchedMatches.sort((a, b) => {
                        const dateTimeA = new Date(`${a.date}T${a.time}`);
                        const dateTimeB = new Date(`${b.date}T${b.time}`);
                        return dateTimeA - dateTimeB;
                    });
                    setMatches(fetchedMatches);
                    setLoadingData(false); // Only set loading to false after all initial data is fetched
                }, (error) => {
                    console.error("Error fetching matches:", error);
                    setMessageAndScroll({ text: "Failed to load matches. Please refresh.", type: "error" });
                    setLoadingData(false);
                });

                return () => {
                    unsubscribePlayers();
                    unsubscribeSubstitutes();
                    unsubscribeTeams();
                    unsubscribeMatches();
                };

            } catch (error) {
                console.error("Error setting up data listeners:", error);
                setMessageAndScroll({ text: "Error loading data.", type: "error" });
                setLoadingData(false);
            }
        };

        fetchAllData();
    }, [db, userId, isAuthReady, totalPlayersCount]); // totalPlayersCount dependency to re-fetch/resize playerInputs

    // --- Filter matches whenever 'matches' or 'showMyMatchesOnly' or 'userId' changes ---
    useEffect(() => {
        if (showMyMatchesOnly && userId) {
            // Filter matches where current user created the match
            const myFiltered = matches.filter(match =>
                match.createdBy === userId
            );
            setFilteredMatches(myFiltered);
        } else {
            setFilteredMatches(matches); // If not filtering, show all matches
        }
    }, [matches, showMyMatchesOnly, userId]);


    // --- Handlers for Player Management ---
    const handlePlayerInputChange = (index, field, value) => {
        const newPlayerInputs = [...playerInputs];
        newPlayerInputs[index] = { ...newPlayerInputs[index], [field]: value };
        setPlayerInputs(newPlayerInputs);
    };

    const addPlayersToFirestore = async () => {
        setMessageAndScroll({ text: null, type: null }); // Clear previous messages
        if (!db || !userId) {
            setMessageAndScroll({ text: "App not ready. Please wait or refresh.", type: "error" });
            return;
        }

        const validPlayers = playerInputs.filter(p => p.name.trim() !== '' && p.handicap !== '' && !isNaN(Number(p.handicap)));
        if (validPlayers.length !== totalPlayersCount) {
            setMessageAndScroll({ text: `Please enter exactly ${totalPlayersCount} player names and valid numeric handicaps for all players.`, type: "error" });
            return;
        }

        try {
            const playersColRef = collection(db, `artifacts/${resolvedAppId}/public/data/players`); // Use resolvedAppId
            // Clear existing players first to avoid duplicates or old data
            const existingPlayersSnapshot = await getDocs(playersColRef);
            for (const docSnapshot of existingPlayersSnapshot.docs) {
                await deleteDoc(doc(db, `artifacts/${resolvedAppId}/public/data/players`, docSnapshot.id)); // Use resolvedAppId
            }

            // Add new players
            const newPlayerDocs = [];
            for (const player of validPlayers) {
                const docRef = await addDoc(playersColRef, {
                    name: player.name.trim(),
                    handicap: Number(player.handicap), // Store as number
                    enteredBy: userId,
                    createdAt: serverTimestamp()
                });
                newPlayerDocs.push({ id: docRef.id, name: player.name.trim(), handicap: Number(player.handicap) });
            }
            setPlayers(newPlayerDocs);
            setMessageAndScroll({ text: `${totalPlayersCount} players with handicaps added successfully!`, type: "success" });
            logAnalyticsEvent('add_players', { player_count: totalPlayersCount, user_id: userId });

        } catch (error) {
            console.error("Error adding players:", error);
            setMessageAndScroll({ text: "Failed to add players. Please try again.", type: "error" });
        }
    };

    // --- Substitute Player Management ---
    const handleAddSubstitutePlayer = async () => {
        setMessageAndScroll({ text: null, type: null }); // Clear previous messages
        if (!db || !userId) {
            setMessageAndScroll({ text: "App not ready. Please wait or refresh.", type: "error" });
            return;
        }
        if (newSubstituteName.trim() === '' || newSubstituteHandicap === '' || isNaN(Number(newSubstituteHandicap))) {
            setMessageAndScroll({ text: "Please enter a valid name and numeric handicap for the substitute player.", type: "error" });
            return;
        }

        try {
            await addDoc(collection(db, `artifacts/${resolvedAppId}/public/data/substitutePlayers`), { // Use resolvedAppId
                name: newSubstituteName.trim(),
                handicap: Number(newSubstituteHandicap),
                enteredBy: userId,
                createdAt: serverTimestamp()
            });
            setMessageAndScroll({ text: `Substitute player "${newSubstituteName}" added!`, type: "success" });
            setNewSubstituteName('');
            setNewSubstituteHandicap('');
            logAnalyticsEvent('add_substitute_player', { substitute_name: newSubstituteName, user_id: userId });
        } catch (error) {
            console.error("Error adding substitute player:", error);
            setMessageAndScroll({ text: "Failed to add substitute player. Please try again.", type: "error" });
        }
    };

    // --- Team Formation with Handicap Balancing ---
    const generateTeams = async () => {
        setMessageAndScroll({ text: null, type: null }); // Clear previous messages
        if (!db || !userId) {
            setMessageAndScroll({ text: "App not ready. Please wait or refresh.", type: "error" });
            return;
        }

        if (players.length !== totalPlayersCount) {
            setMessageAndScroll({ text: `Need exactly ${totalPlayersCount} players to form ${numberOfTeams} teams. Please add players with handicaps first.`, type: "error" });
            return;
        }

        if (!isTotalPlayersEven || totalPlayersCount < 2) {
            setMessageAndScroll({ text: "Total players must be an even number and at least 2 to form doubles teams.", type: "error" });
            return;
        }

        try {
            const teamsColRef = collection(db, `artifacts/${resolvedAppId}/public/data/teams`); // Use resolvedAppId
            // Clear existing teams first
            const existingTeamsSnapshot = await getDocs(teamsColRef);
            for (const docSnapshot of existingTeamsSnapshot.docs) {
                await deleteDoc(doc(db, `artifacts/${resolvedAppId}/public/data/teams`, docSnapshot.id)); // Use resolvedAppId
            }

            // Sort players by handicap in ascending order (lowest handicap = strongest player in some systems, depends on definition)
            const sortedPlayers = [...players].sort((a, b) => a.handicap - b.handicap); // Strongest (low handicap) to Weakest (high handicap)

            const newTeams = [];
            for (let i = 0; i < numberOfTeams; i++) {
                // Pair strongest with weakest, 2nd strongest with 2nd weakest etc.
                const player1 = sortedPlayers[i]; // Stronger player from the front
                const player2 = sortedPlayers[sortedPlayers.length - 1 - i]; // Weaker player from the back

                const teamName = `Team ${String.fromCharCode(65 + i)}`; // Team A, Team B, etc.
                const teamHandicapSum = player1.handicap + player2.handicap;

                const docRef = await addDoc(teamsColRef, {
                    name: teamName,
                    player1Id: player1.id,
                    player2Id: player2.id,
                    player1Name: player1.name,
                    player2Name: player2.name,
                    player1Handicap: player1.handicap, // Store individual handicaps
                    player2Handicap: player2.handicap,
                    teamHandicapSum: teamHandicapSum, // Store combined handicap for easier display/analysis
                    createdBy: userId,
                    createdAt: serverTimestamp()
                });
                newTeams.push({
                    id: docRef.id,
                    name: teamName,
                    player1Name: player1.name,
                    player2Name: player2.name,
                    player1Handicap: player1.handicap,
                    player2Handicap: player2.handicap,
                    teamHandicapSum: teamHandicapSum
                });
            }
            // Sort teams by their combined handicap for display (optional, but can show balancing effectiveness)
            newTeams.sort((a,b) => a.teamHandicapSum - b.teamHandicapSum);

            setTeams(newTeams);
            setMessageAndScroll({ text: `${numberOfTeams} doubles teams generated and balanced by handicap!`, type: "success" });
            logAnalyticsEvent('generate_teams', { num_teams: numberOfTeams, user_id: userId });
        } catch (error) {
            console.error("Error generating teams:", error);
            setMessageAndScroll({ text: "Failed to generate teams. Please try again.", type: "error" });
        }
    };

    // --- Simplified Round Robin Schedule Generation ---
    const generateSchedule = async () => {
        setMessageAndScroll({ text: null, type: null }); // Clear previous messages
        if (!db || !userId) {
            setMessageAndScroll({ text: "App not ready. Please wait or refresh.", type: "error" });
            return;
        }
        if (teams.length !== numberOfTeams) {
            setMessageAndScroll({ text: `Need ${numberOfTeams} teams to generate a schedule. Please generate teams first.`, type: "error" });
            return;
        }
        if (courtsPerDayCount <= 0 || tournamentDurationDays <= 0) {
            setMessageAndScroll({ text: "Number of courts and tournament duration must be positive values.", type: "error" });
            return;
        }


        try {
            const matchesColRef = collection(db, `artifacts/${resolvedAppId}/public/data/matches`); // Use resolvedAppId
            // Clear existing matches first
            const existingMatchesSnapshot = await getDocs(matchesColRef);
            for (const docSnapshot of existingMatchesSnapshot.docs) {
                await deleteDoc(doc(db, `artifacts/${resolvedAppId}/public/data/matches`, docSnapshot.id)); // Use resolvedAppId
            }

            const courts = Array.from({ length: courtsPerDayCount }, (_, i) => `Court ${i + 1}`); // Dynamic courts
            const days = tournamentDurationDays; // Dynamic days
            const timesPerDay = ['09:00', '10:30', '12:00', '13:30']; // Time slots per day

            const allTeams = [...teams];
            let teamPairs = []; // To store unique pairs for matches

            // Generate all possible unique pairs of teams (simple approximation for a tournament)
            for (let i = 0; i < allTeams.length; i++) {
                for (let j = i + 1; j < allTeams.length; j++) {
                    teamPairs.push([allTeams[i], allTeams[j]]);
                }
            }
            teamPairs = teamPairs.sort(() => 0.5 - Math.random()); // Shuffle pairs

            let matchCounter = 0;
            let currentPairIndex = 0;
            const newMatches = [];

            for (let day = 0; day < days; day++) {
                const currentDate = new Date();
                currentDate.setDate(currentDate.getDate() + day); // Start from today + day offset
                const formattedDate = currentDate.toISOString().split('T')[0]; // Format asYYYY-MM-DD

                for (const time of timesPerDay) {
                    for (const court of courts) {
                        if (currentPairIndex < teamPairs.length) {
                            const [team1, team2] = teamPairs[currentPairIndex];

                            const docRef = await addDoc(matchesColRef, {
                                date: formattedDate,
                                time: time,
                                court: court,
                                team1Id: team1.id,
                                team2Id: team2.id,
                                team1Name: team1.name,
                                team2Name: team2.name,
                                team1OriginalPlayer1Name: team1.player1Name, // Store original player names for substitution
                                team1OriginalPlayer2Name: team1.player2Name,
                                team2OriginalPlayer1Name: team2.player1Name,
                                team2OriginalPlayer2Name: team2.player2Name,
                                team1OriginalPlayer1Handicap: team1.player1Handicap,
                                team1OriginalPlayer2Handicap: team1.player2Handicap,
                                team2OriginalPlayer1Handicap: team2.player1Handicap,
                                team2OriginalPlayer2Handicap: team2.player2Handicap,
                                team1HandicapSum: team1.teamHandicapSum, // Store current team handicaps in match
                                team2HandicapSum: team2.teamHandicapSum,
                                status: 'scheduled',
                                createdBy: userId,
                                createdAt: serverTimestamp(),
                                substituteInfo: null, // { affectedTeam: 'team1'/'team2', originalPlayerName: '', substitutePlayerName: '', newTeamHandicapSum: 0 }
                                score: null, // Initialize score as null
                                winnerTeamId: null,
                                loserTeamId: null
                            });
                            newMatches.push({
                                id: docRef.id,
                                date: formattedDate,
                                time: time,
                                court: court,
                                team1Name: team1.name,
                                team2Name: team2.name,
                                team1OriginalPlayer1Name: team1.player1Name,
                                team1OriginalPlayer2Name: team1.player2Name,
                                team2OriginalPlayer1Name: team2.player1Name,
                                team2OriginalPlayer2Name: team2.player2Name,
                                team1OriginalPlayer1Handicap: team1.player1Handicap,
                                team1OriginalPlayer2Handicap: team1.player2Handicap,
                                team2OriginalPlayer1Handicap: team2.player1Handicap,
                                team2OriginalPlayer2Handicap: team2.player2Handicap,
                                team1HandicapSum: team1.teamHandicapSum,
                                team2HandicapSum: team2.teamHandicapSum,
                                status: 'scheduled',
                                createdBy: userId,
                                substituteInfo: null,
                                score: null,
                                winnerTeamId: null,
                                loserTeamId: null
                            });
                            matchCounter++;
                            currentPairIndex++;
                        } else {
                            // No more pairs to schedule
                            break;
                        }
                    }
                    if (currentPairIndex >= teamPairs.length) break;
                }
                if (currentPairIndex >= teamPairs.length) break;
            }

            setMatches(newMatches); // Update local state
            setMessageAndScroll({ text: `Generated ${matchCounter} matches across ${days} days using ${courts.length} courts!`, type: "success" }); // Updated message
            logAnalyticsEvent('generate_schedule', {
                matches_generated: matchCounter,
                days_duration: days,
                courts_used: courts.length,
                user_id: userId
            });
        } catch (error) {
            console.error("Error generating schedule:", error);
            setMessageAndScroll({ text: "Failed to generate schedule. Please try again.", type: "error" });
        }
    };

    // --- Match Cancellation ---
    const handleCancelMatch = async () => {
        setMessageAndScroll({ text: null, type: null }); // Clear previous messages
        if (!db || !matchToCancel) {
            setMessageAndScroll({ text: "Cannot cancel match. App not ready or no match selected.", type: "error" });
            setMatchToCancel(null); // Clear selection
            return;
        }

        try {
            await updateDoc(doc(db, `artifacts/${resolvedAppId}/public/data/matches`, matchToCancel.id), { // Use resolvedAppId
                status: 'cancelled',
                cancelledBy: userId,
                cancelledAt: serverTimestamp()
            });
            setMessageAndScroll({ text: `Match on ${matchToCancel.date} at ${matchToCancel.time} on ${matchToCancel.court} cancelled.`, type: "success" });
            logAnalyticsEvent('cancel_match', { match_id: matchToCancel.id, user_id: userId });
        } catch (error) {
            console.error("Error cancelling match:", error);
            setMessageAndScroll({ text: "Failed to cancel match. Please try again.", type: "error" });
        } finally {
            setMatchToCancel(null); // Close modal
        }
    };

    // --- Handle Substitution Logic ---
    const handleOpenSubstituteModal = (match) => {
        setSelectedMatchForSubstitution(match);
        setPlayerToSubstituteKey(''); // Reset dropdown
        setSelectedSubstituteId(''); // Reset dropdown
        setShowSubstituteModal(true);
    };

    const handleConfirmSubstitution = async () => {
        setMessageAndScroll({ text: null, type: null }); // Clear previous messages
        if (!db || !selectedMatchForSubstitution || !playerToSubstituteKey || !selectedSubstituteId) {
            setMessageAndScroll({ text: "Please select a match, player to substitute, and a substitute player.", type: "error" });
            return;
        }

        const match = selectedMatchForSubstitution;
        const substitute = substitutePlayers.find(s => s.id === selectedSubstituteId);
        if (!substitute) {
            setMessageAndScroll({ text: "Selected substitute player not found.", type: "error" });
            return;
        }

        let updatedMatchData = { ...match };
        let originalPlayerName = '';
        let originalPlayerHandicap = 0;
        let affectedTeamKey = ''; // 'team1' or 'team2'

        // Determine which player is being substituted and update match data
        if (playerToSubstituteKey === 'team1_player1') {
            originalPlayerName = match.team1OriginalPlayer1Name;
            originalPlayerHandicap = match.team1OriginalPlayer1Handicap;
            updatedMatchData.team1Name = `${match.team1Name.split(' (w/ Sub)')[0]} (w/ Sub)`; // Maintain or add (w/ Sub)
            updatedMatchData.team1OriginalPlayer1Name = substitute.name; // Update player name in match document for display
            updatedMatchData.team1OriginalPlayer1Handicap = substitute.handicap;
            updatedMatchData.team1HandicapSum = match.team1HandicapSum - originalPlayerHandicap + substitute.handicap;
            affectedTeamKey = 'team1';
        } else if (playerToSubstituteKey === 'team1_player2') {
            originalPlayerName = match.team1OriginalPlayer2Name;
            originalPlayerHandicap = match.team1OriginalPlayer2Handicap;
            updatedMatchData.team1Name = `${match.team1Name.split(' (w/ Sub)')[0]} (w/ Sub)`;
            updatedMatchData.team1OriginalPlayer2Name = substitute.name;
            updatedMatchData.team1OriginalPlayer2Handicap = substitute.handicap;
            updatedMatchData.team1HandicapSum = match.team1HandicapSum - originalPlayerHandicap + substitute.handicap;
            affectedTeamKey = 'team1';
        } else if (playerToSubstituteKey === 'team2_player1') {
            originalPlayerName = match.team2OriginalPlayer1Name;
            originalPlayerHandicap = match.team2OriginalPlayer1Handicap;
            updatedMatchData.team2Name = `${match.team2Name.split(' (w/ Sub)')[0]} (w/ Sub)`;
            updatedMatchData.team2OriginalPlayer1Name = substitute.name;
            updatedMatchData.team2OriginalPlayer1Handicap = substitute.handicap;
            updatedMatchData.team2HandicapSum = match.team2HandicapSum - originalPlayerHandicap + substitute.handicap;
            affectedTeamKey = 'team2';
        } else if (playerToSubstituteKey === 'team2_player2') {
            originalPlayerName = match.team2OriginalPlayer2Name;
            originalPlayerHandicap = match.team2OriginalPlayer2Handicap;
            updatedMatchData.team2Name = `${match.team2Name.split(' (w/ Sub)')[0]} (w/ Sub)`;
            updatedMatchData.team2OriginalPlayer2Name = substitute.name;
            updatedMatchData.team2OriginalPlayer2Handicap = substitute.handicap;
            updatedMatchData.team2HandicapSum = match.team2HandicapSum - originalPlayerHandicap + substitute.handicap;
            affectedTeamKey = 'team2';
        }

        // Add substitution info to the match document
        updatedMatchData.substituteInfo = {
            affectedTeamKey: affectedTeamKey,
            originalPlayerName: originalPlayerName,
            substitutePlayerName: substitute.name,
            substitutedByUserId: userId,
            substitutionDate: serverTimestamp(),
            newTeamHandicapSum: updatedMatchData[`${affectedTeamKey}HandicapSum`] // Record the new handicap sum
        };

        try {
            await updateDoc(doc(db, `artifacts/${resolvedAppId}/public/data/matches`, match.id), updatedMatchData); // Use resolvedAppId
            setMessageAndScroll({ text: `Substitution successful! ${originalPlayerName} replaced by ${substitute.name} for match on ${match.date}.`, type: "success" });
            logAnalyticsEvent('confirm_substitution', {
                match_id: match.id,
                original_player: originalPlayerName,
                substitute_player: substitute.name,
                user_id: userId
            });
        } catch (error) {
            console.error("Error confirming substitution:", error);
            setMessageAndScroll({ text: "Failed to apply substitution. Please try again.", type: "error" });
        } finally {
            setShowSubstituteModal(false);
            setSelectedMatchForSubstitution(null);
            setPlayerToSubstituteKey('');
            setSelectedSubstituteId('');
        }
    };

    // --- Handle Score Entry Logic ---
    const handleSaveScore = async (matchId, scoreData) => {
        setMessageAndScroll({ text: null, type: null }); // Clear previous messages
        if (!db || !userId) {
            setMessageAndScroll({ text: "App not ready. Please wait or refresh.", type: "error" });
            return;
        }

        const match = matches.find(m => m.id === matchId);
        if (!match) {
            setMessageAndScroll({ text: "Match not found.", type: "error" });
            return;
        }

        let team1SetsWon = 0;
        let team2SetsWon = 0;
        let isValidScore = true;

        for (const set of scoreData) {
            const t1Games = Number(set.team1Games);
            const t2Games = Number(set.team2Games);
            const t1Tie = Number(set.tiebreaker?.team1Points);
            const t2Tie = Number(set.tiebreaker?.team2Points);

            // Basic validation
            if (isNaN(t1Games) || isNaN(t2Games) || t1Games < 0 || t2Games < 0) {
                isValidScore = false;
                setMessageAndScroll({ text: "Invalid game scores. Please enter non-negative numbers.", type: "error" });
                break;
            }

            // Standard set win condition
            const t1WinsSet = t1Games >= gamesToWinSet && t1Games - t2Games >= 2;
            const t2WinsSet = t2Games >= gamesToWinSet && t2Games - t1Games >= 2;

            // Tiebreaker condition
            const isTiebreakerSet = (t1Games === tiebreakerScoreThreshold && t2Games === tiebreakerScoreThreshold);

            if (isTiebreakerSet) {
                if (isNaN(t1Tie) || isNaN(t2Tie) || t1Tie < 0 || t2Tie < 0) {
                    isValidScore = false;
                    setMessageAndScroll({ text: "Invalid tiebreaker scores. Please enter non-negative numbers.", type: "error" });
                    break;
                }
                const t1WinsTiebreaker = t1Tie >= tiebreakerPointsToWin && t1Tie - t2Tie >= tiebreakerMinWinDifference;
                const t2WinsTiebreaker = t2Tie >= tiebreakerPointsToWin && t2Tie - t1Tie >= tiebreakerMinWinDifference;

                if (!(t1WinsTiebreaker || t2WinsTiebreaker)) {
                    isValidScore = false;
                    setMessageAndScroll({ text: `Tiebreaker must be won by at least ${tiebreakerMinWinDifference} points and reach ${tiebreakerPointsToWin} points.`, type: "error" });
                    break;
                }
                if (t1WinsTiebreaker) team1SetsWon++;
                if (t2WinsTiebreaker) team2SetsWon++;

            } else if (t1WinsSet || t2WinsSet) {
                if (t1WinsSet) team1SetsWon++;
                if (t2WinsSet) team2SetsWon++;
            } else {
                isValidScore = false;
                setMessageAndScroll({ text: `Set not won. One team must reach ${gamesToWinSet} games and win by at least 2, or enter a tiebreaker at ${tiebreakerScoreThreshold}-${tiebreakerScoreThreshold}.`, type: "error" });
                break;
            }
        }

        if (!isValidScore) {
            return;
        }

        let winnerTeamId = null;
        let loserTeamId = null;
        if (team1SetsWon === setsToWinMatch) {
            winnerTeamId = match.team1Id;
            loserTeamId = match.team2Id;
        } else if (team2SetsWon === setsToWinMatch) {
            winnerTeamId = match.team2Id;
            loserTeamId = match.team1Id;
        } else {
            isValidScore = false;
            setMessageAndScroll({ text: `Match not completed. One team must win ${setsToWinMatch} sets.`, type: "error" });
        }

        if (!isValidScore) {
            return;
        }

        try {
            await updateDoc(doc(db, `artifacts/${resolvedAppId}/public/data/matches`, matchId), { // Use resolvedAppId
                score: scoreData,
                status: 'completed',
                winnerTeamId: winnerTeamId,
                loserTeamId: loserTeamId,
                completedBy: userId,
                completedAt: serverTimestamp()
            });
            setMessageAndScroll({ text: `Score recorded for match on ${match.date}.`, type: "success" });
            logAnalyticsEvent('save_score', {
                match_id: match.id,
                team1_score: scoreData.map(s => s.team1Games).join('-'),
                team2_score: scoreData.map(s => s.team2Games).join('-'),
                winner_team_id: winnerTeamId,
                loser_team_id: loserTeamId,
                user_id: userId
            });
        } catch (error) {
            console.error("Error saving score:", error);
            setMessageAndScroll({ text: "Failed to save score. Please try again.", type: "error" });
        } finally {
            setShowScoreEntryModal(false);
            setMatchForScoreEntry(null);
        }
    };


    // --- Clear All Data (Admin-like function) ---
    const handleClearAllData = async () => {
        setMessageAndScroll({ text: null, type: null }); // Clear previous messages
        if (!db || !userId) {
            setMessageAndScroll({ text: "App not ready. Please wait or refresh.", type: "error" });
            setShowClearDataConfirm(false);
            return;
        }

        try {
            // Delete players
            const playersSnapshot = await getDocs(collection(db, `artifacts/${resolvedAppId}/public/data/players`)); // Use resolvedAppId
            for (const docSnapshot of playersSnapshot.docs) {
                await deleteDoc(doc(db, `artifacts/${resolvedAppId}/public/data/players`, docSnapshot.id)); // Use resolvedAppId
            }
            setPlayers([]);
            setPlayerInputs(Array(totalPlayersCount).fill({ name: '', handicap: '' })); // Reset player input fields based on current config

            // Delete substitute players
            const substitutesSnapshot = await getDocs(collection(db, `artifacts/${resolvedAppId}/public/data/substitutePlayers`)); // Use resolvedAppId
            for (const docSnapshot of substitutesSnapshot.docs) {
                await deleteDoc(doc(db, `artifacts/${resolvedAppId}/public/data/substitutePlayers`, docSnapshot.id)); // Use resolvedAppId
            }
            setSubstitutePlayers([]);
            setNewSubstituteName('');
            setNewSubstituteHandicap('');

            // Delete teams
            const teamsSnapshot = await getDocs(collection(db, `artifacts/${resolvedAppId}/public/data/teams`)); // Use resolvedAppId
            for (const docSnapshot of teamsSnapshot.docs) {
                await deleteDoc(doc(db, `artifacts/${resolvedAppId}/public/data/teams`, docSnapshot.id)); // Use resolvedAppId
            }
            setTeams([]);

            // Delete matches
            const matchesSnapshot = await getDocs(collection(db, `artifacts/${resolvedAppId}/public/data/matches`)); // Use resolvedAppId
            for (const docSnapshot of matchesSnapshot.docs) {
                await deleteDoc(doc(db, `artifacts/${resolvedAppId}/public/data/matches`, docSnapshot.id)); // Use resolvedAppId
            }
            setMatches([]);
            setFilteredMatches([]);

            setMessageAndScroll({ text: "All tournament data cleared successfully!", type: "success" });
            logAnalyticsEvent('clear_all_data', { user_id: userId });
        } catch (error) {
            console.error("Error clearing all data:", error);
            setMessageAndScroll({ text: "Failed to clear all data. Please try again.", type: "error" });
        } finally {
            setShowClearDataConfirm(false); // Close confirmation modal
        }
    };


    // --- Gemini API: Analyze Match ---
    const handleAnalyzeMatch = async (match) => {
        setMessageAndScroll({ text: null, type: null }); // Clear previous messages
        setAnalyzingMatchId(match.id); // Set loading state for this match

        const team1PlayerNames = match.substituteInfo && match.substituteInfo.affectedTeamKey === 'team1'
            ? `${match.substituteInfo.originalPlayerName} replaced by ${match.substituteInfo.substitutePlayerName}`
            : `${match.team1OriginalPlayer1Name}, ${match.team1OriginalPlayer2Name}`;

        const team2PlayerNames = match.substituteInfo && match.substituteInfo.affectedTeamKey === 'team2'
            ? `${match.substituteInfo.originalPlayerName} replaced by ${match.substituteInfo.substitutePlayerName}`
            : `${match.team2OriginalPlayer1Name}, ${match.team2OriginalPlayer2Name}`;

        const prompt = `Analyze the potential outcome and dynamics of a tennis doubles match between "${match.team1Name}" (players: ${team1PlayerNames}, combined handicap: ${match.team1HandicapSum}) and "${match.team2Name}" (players: ${team2PlayerNames}, combined handicap: ${match.team2HandicapSum}). Consider the handicaps; a lower handicap means a stronger player/team. Provide a brief, insightful analysis.`;

        let chatHistory = [];
        chatHistory.push({ role: "user", parts: [{ text: prompt }] });

        const payload = { contents: chatHistory };
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`; // Use geminiApiKey

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API error: ${response.status} - ${errorData.error.message}`);
            }

            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const analysisText = result.candidates[0].content.parts[0].text;
                setMessageAndScroll({ text: `Match Analysis for ${match.team1Name} vs ${match.team2Name}:\n\n${analysisText}`, type: "analysis" });
                logAnalyticsEvent('analyze_match', { match_id: match.id, user_id: userId });
            } else {
                setMessageAndScroll({ text: "Failed to get match analysis. Unexpected API response.", type: "error" });
            }
        } catch (error) {
            console.error("Error calling Gemini API:", error);
            setMessageAndScroll({ text: `Error analyzing match: ${error.message || "Please try again."}`, type: "error" });
        } finally {
            setAnalyzingMatchId(null); // Clear loading state
        }
    };

    // --- Gemini API: Get Tournament Overview/Insights ---
    const handleGetTournamentInsights = async () => {
        setMessageAndScroll({ text: null, type: null }); // Clear previous messages
        setGettingTournamentInsights(true);

        if (matches.length === 0) {
            setMessageAndScroll({ text: "No matches found to generate tournament insights. Please generate a schedule first.", type: "info" });
            setGettingTournamentInsights(false);
            return;
        }

        let summary = `Generate a high-level overview and insights for a tennis round robin tournament with the following characteristics:\n\n`;
        summary += `Tournament Configuration:\n`;
        summary += `- Total Players: ${totalPlayersCount}\n`;
        summary += `- Number of Teams (Doubles): ${numberOfTeams}\n`;
        summary += `- Courts Per Day: ${courtsPerDayCount}\n`;
        summary += `- Tournament Duration: ${tournamentDurationDays} days\n`;
        summary += `- Total Matches Scheduled: ${matches.length}\n`;

        // Optional: Add some details about teams/handicaps if available and useful
        if (teams.length > 0) {
            const teamHandicaps = teams.map(team => team.teamHandicapSum).sort((a,b) => a-b);
            const minHandicap = teamHandicaps[0];
            const maxHandicap = teamHandicaps[teamHandicaps.length - 1];
            const avgHandicap = (teamHandicaps.reduce((sum, h) => sum + h, 0) / teamHandicaps.length).toFixed(1);
            summary += `- Team Handicaps Range (min-max): ${minHandicap}-${maxHandicap} (average: ${avgHandicap})\n`;
            summary += `- Number of Substitute Players Available: ${substitutePlayers.length}\n`;
        }

        summary += `\nConsider the scale of the tournament and potential competitive balance based on the handicaps. Provide insights on what this structure might mean for player experience, competition, or logistical considerations. Keep the response concise and engaging.`;


        let chatHistory = [];
        chatHistory.push({ role: "user", parts: [{ text: summary }] });

        const payload = { contents: chatHistory };
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`; // Use geminiApiKey

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API error: ${response.status} - ${errorData.error.message}`);
            }

            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const insightsText = result.candidates[0].content.parts[0].text;
                setMessageAndScroll({ text: `Tournament Overview & Insights:\n\n${insightsText}`, type: "analysis" });
                logAnalyticsEvent('get_tournament_insights', {
                    total_players: totalPlayersCount,
                    total_matches: matches.length,
                    user_id: userId
                });
            } else {
                setMessageAndScroll({ text: "Failed to get tournament insights. Unexpected API response.", type: "error" });
            }
        } catch (error) {
            console.error("Error calling Gemini API for tournament insights:", error);
            setMessageAndScroll({ text: `Error getting tournament insights: ${error.message || "Please try again."}`, type: "error" });
        } finally {
            setGettingTournamentInsights(false);
        }
    };


    // --- Gemini API: Get Player Performance Insights ---
    const handleGetPlayerPerformanceInsights = async (player) => {
        setMessageAndScroll({ text: null, type: null }); // Clear previous messages
        setAnalyzingPlayerId(player.id); // Set loading state for this player
        const prompt = `Generate a concise performance analysis for a tennis player with the following statistics:\n` +
                       `Name: ${player.name}\n` +
                       `Handicap: ${player.handicap}\n` + // Corrected here
                       `Matches Played: ${player.matchesPlayed}\n` +
                       `Wins: ${player.wins}\n` +
                       `Losses: ${player.losses}\n` +
                       `Win Percentage: ${player.winRate}%\n\n` +
                       `Highlight their strengths, weaknesses, and potential areas for improvement based on these stats. Keep it to 2-3 sentences.`;

        let chatHistory = [];
        chatHistory.push({ role: "user", parts: [{ text: prompt }] });

        const payload = { contents: chatHistory };
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`; // Use geminiApiKey

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API error: ${response.status} - ${errorData.error.message}`);
            }

            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const analysisText = result.candidates[0].content.parts[0].text;
                setMessageAndScroll({ text: `Performance Insights for ${player.name}:\n\n${analysisText}`, type: "analysis" });
                logAnalyticsEvent('get_player_insights', {
                    player_id: player.id,
                    player_name: player.name,
                    matches_played: player.matchesPlayed,
                    wins: player.wins,
                    losses: player.losses,
                    user_id: userId
                });
            } else {
                setMessageAndScroll({ text: "Failed to get player performance insights. Unexpected API response.", type: "error" });
            }
        } catch (error) {
            console.error("Error calling Gemini API for player insights:", error);
            setMessageAndScroll({ text: `Error getting player insights: ${error.message || "Please try again."}`, type: "error" });
        } finally {
            setAnalyzingPlayerId(null); // Clear loading state
        }
    };

    // --- Gemini API: Get Optimal Player Pairings ---
    const handleGetOptimalPairings = async () => {
        setMessageAndScroll({ text: null, type: null }); // Clear previous messages
        setGettingOptimalPairings(true);

        if (players.length === 0) {
            setMessageAndScroll({ text: "No players found to suggest pairings. Please add players first.", type: "info" });
            setGettingOptimalPairings(false);
            return;
        }
        if (players.length % 2 !== 0) {
            setMessageAndScroll({ text: "Cannot suggest optimal doubles pairings with an odd number of players.", type: "error" });
            setGettingOptimalPairings(false);
            return;
        }

        const playerList = players.map(p => `${p.name} (Handicap: ${p.handicap})`).join(', ');

        const prompt = `Given the following list of tennis players with their handicaps (lower handicap means stronger player), suggest optimal doubles pairings for a balanced and competitive round-robin tournament. Form pairs of two players. The goal is to create teams with similar combined handicaps or to pair stronger players with weaker players to balance skill levels across teams. Each player must be in exactly one pair. Provide the pairings as a list, clearly stating the players in each team and their combined handicap. Example: 'Team A: Player One (H:5) & Player Two (H:7) - Combined: 12'\n\nPlayers: ${playerList}`;

        let chatHistory = [];
        chatHistory.push({ role: "user", parts: [{ text: prompt }] });

        const payload = { contents: chatHistory };
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`; // Use geminiApiKey

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API error: ${response.status} - ${errorData.error.message}`);
            }

            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const pairingsText = result.candidates[0].content.parts[0].text;
                setMessageAndScroll({ text: `Suggested Optimal Pairings:\n\n${pairingsText}`, type: "analysis" });
                logAnalyticsEvent('get_optimal_pairings', { player_count: players.length, user_id: userId });
            } else {
                setMessageAndScroll({ text: "Failed to get optimal pairings. Unexpected API response.", type: "error" });
            }
        } catch (error) {
            console.error("Error calling Gemini API for optimal pairings:", error);
            setMessageAndScroll({ text: `Error getting optimal pairings: ${error.message || "Please try again."}`, type: "error" });
        } finally {
            setGettingOptimalPairings(false);
        }
    };


    // --- Calculate Player Statistics and Team Standings ---
    const calculateStats = useMemo(() => {
        const playerStats = {}; // { playerId: { name, handicap, matchesPlayed, wins, losses, winRate } }
        const teamStandings = {}; // { teamId: { name, handicapSum, matchesPlayed, wins, losses, winRate } }

        // Initialize player stats
        players.forEach(p => {
            playerStats[p.id] = {
                id: p.id, // Include ID for button
                name: p.name,
                handicap: p.handicap,
                matchesPlayed: 0,
                wins: 0,
                losses: 0,
                winRate: 0
            };
        });

        // Initialize team standings
        teams.forEach(t => {
            teamStandings[t.id] = {
                name: t.name,
                handicapSum: t.teamHandicapSum,
                matchesPlayed: 0,
                wins: 0,
                losses: 0,
                winRate: 0
            };
        });

        matches.filter(match => match.status === 'completed' && match.winnerTeamId && match.loserTeamId).forEach(match => {
            const winnerTeam = teams.find(t => t.id === match.winnerTeamId);
            const loserTeam = teams.find(t => t.id === match.loserTeamId);

            if (winnerTeam) {
                // Update winner team stats
                teamStandings[winnerTeam.id].matchesPlayed++;
                teamStandings[winnerTeam.id].wins++;

                // Update winner players stats
                const player1 = players.find(p => p.id === winnerTeam.player1Id);
                const player2 = players.find(p => p.id === winnerTeam.player2Id);
                if (player1) {
                    playerStats[player1.id].matchesPlayed++;
                    playerStats[player1.id].wins++;
                }
                if (player2) {
                    playerStats[player2.id].matchesPlayed++;
                    playerStats[player2.id].wins++;
                }
            }

            if (loserTeam) {
                // Update loser team stats
                teamStandings[loserTeam.id].matchesPlayed++;
                teamStandings[loserTeam.id].losses++;

                // Update loser players stats
                const player1 = players.find(p => p.id === loserTeam.player1Id);
                const player2 = players.find(p => p.id === loserTeam.player2Id);
                if (player1) {
                    playerStats[player1.id].matchesPlayed++;
                    playerStats[player1.id].losses++;
                }
                if (player2) {
                    playerStats[player2.id].matchesPlayed++;
                    playerStats[player2.id].losses++;
                }
            }
        });

        // Calculate win rates
        Object.values(playerStats).forEach(p => {
            p.winRate = p.matchesPlayed > 0 ? ((p.wins / p.matchesPlayed) * 100).toFixed(1) : 0;
        });
        Object.values(teamStandings).forEach(t => {
            t.winRate = t.matchesPlayed > 0 ? ((t.wins / t.matchesPlayed) * 100).toFixed(1) : 0;
        });

        // Sort for display
        const sortedPlayers = Object.values(playerStats).sort((a, b) => b.winRate - a.winRate || b.wins - a.wins);
        const sortedTeams = Object.values(teamStandings).sort((a, b) => b.winRate - a.winRate || b.wins - a.wins);

        return { sortedPlayers, sortedTeams };
    }, [matches, players, teams]); // Recalculate when matches, players, or teams data changes

    // --- Print Schedule Function ---
    const handlePrintSchedule = () => {
        // Create a new window for printing
        const printWindow = window.open('', '', 'height=600,width=800');
        printWindow.document.write('<html><head><title>Tournament Schedule</title>');
        // Include minimal styles for printing
        printWindow.document.write(`
            <style>
                body { font-family: 'Inter', sans-serif; margin: 20px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background-color: #f2f2f2; }
                h1 { text-align: center; margin-bottom: 20px; }
                .match-details p { margin: 0; line-height: 1.2; }
                .match-details .font-semibold { font-weight: 600; }
                .line-through { text-decoration: line-through; }
                .text-red-600 { color: #dc2626; }
                .text-green-600 { color: #16a34a; }
                /* Hide print actions/buttons */
                .print-hide { display: none !important; }
            </style>
        `);
        printWindow.document.write('</head><body>');
        printWindow.document.write('<h1>Tennis Round Robin Tournament Schedule</h1>');
        printWindow.document.write(`<p>Total Players: ${totalPlayersCount} | Courts Per Day: ${courtsPerDayCount} | Duration: ${tournamentDurationDays} Days</p>`);


        // Get the schedule table HTML
        const scheduleTable = document.querySelector('.schedule-table'); // Select the table by a class name
        if (scheduleTable) {
            // Clone the table and remove the 'Actions' column and 'print-hide' class
            const clonedTable = scheduleTable.cloneNode(true);
            const headerRow = clonedTable.querySelector('thead tr');
            const actionHeader = headerRow.querySelector('.print-hide');
            if (actionHeader) {
                actionHeader.remove();
            }
            clonedTable.querySelectorAll('tbody tr').forEach(row => {
                const actionCell = row.querySelector('.print-hide');
                if (actionCell) {
                    actionCell.remove();
                }
            });

            printWindow.document.write(clonedTable.outerHTML);
        } else {
            printWindow.document.write('<p>Schedule table not found.</p>');
        }

        printWindow.document.write('</body></html>');
        printWindow.document.close();
        printWindow.print();
        logAnalyticsEvent('print_schedule', { user_id: userId });
    };


    // Confirmation Modal Component
    const ConfirmationModal = ({ show, title, message, onConfirm, onCancel }) => {
        if (!show) return null;
        return (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm space-y-4 rounded-md-lg">
                    <h3 className="text-xl font-bold text-gray-800">{title}</h3>
                    <p className="text-gray-700">{message}</p>
                    <div className="flex justify-end space-x-3">
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors rounded-md-lg"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={onConfirm}
                            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors rounded-md-lg"
                        >
                            Confirm
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // Substitute Player Modal Component
    const SubstitutePlayerModal = ({ show, match, substitutePlayers, onConfirm, onCancel, playerToSubstituteKey, setPlayerToSubstituteKey, selectedSubstituteId, setSelectedSubstituteId }) => {
        if (!show) return null; // Added early exit for !show

        // Guard against `match` being null if the modal somehow opens without a selected match
        if (!match) {
            console.warn("SubstitutePlayerModal opened without a match object.");
            return null;
        }

        const playersInMatch = [
            { key: 'team1_player1', teamName: match.team1Name, playerName: match.team1OriginalPlayer1Name },
            { key: 'team1_player2', teamName: match.team1Name, playerName: match.team1OriginalPlayer2Name },
            { key: 'team2_player1', teamName: match.team2Name, playerName: match.team2OriginalPlayer1Name },
            { key: 'team2_player2', teamName: match.team2Name, playerName: match.team2OriginalPlayer2Name },
        ];

        return (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md space-y-5 rounded-md-lg">
                    <h3 className="text-xl font-bold text-gray-800">Substitute Player for Match</h3>
                    <p className="text-gray-700">
                        Match: {match.date} at {match.time} on {match.court}<br/>
                        Teams: {match.team1Name} (Handicap: {match.team1HandicapSum}) vs {match.team2Name} (Handicap: {match.team2HandicapSum})
                    </p>

                    <div>
                        <label htmlFor="player-to-sub" className="block text-sm font-medium text-gray-700 mb-1">
                            Select Player to Substitute
                        </label>
                        <select
                            id="player-to-sub"
                            className="input-field w-full"
                            value={playerToSubstituteKey}
                            onChange={(e) => setPlayerToSubstituteKey(e.target.value)}
                        >
                            <option value="">-- Select a player --</option>
                            {playersInMatch.map(p => (
                                <option key={p.key} value={p.key}>
                                    {p.teamName} - {p.playerName}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="substitute-player" className="block text-sm font-medium text-gray-700 mb-1">
                            Select Substitute Player
                        </label>
                        <select
                            id="substitute-player"
                            className="input-field w-full"
                            value={selectedSubstituteId}
                            onChange={(e) => setSelectedSubstituteId(e.target.value)}
                        >
                            <option value="">-- Select a substitute --</option>
                            {substitutePlayers.map(sub => (
                                <option key={sub.id} value={sub.id}>
                                    {sub.name} (Handicap: {sub.handicap})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="flex justify-end space-x-3">
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors rounded-md-lg"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={onConfirm}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors rounded-md-lg"
                            disabled={!playerToSubstituteKey || !selectedSubstituteId}
                        >
                            Confirm Substitution
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // Score Entry Modal Component
    const ScoreEntryModal = ({ show, match, config, onSave, onCancel }) => {
        if (!show || !match) return null;

        // Initialize scores based on existing data or default
        const initialScores = match.score || Array(config.setsToWinMatch * 2 - 1).fill(null).map(() => ({ team1Games: '', team2Games: '', tiebreaker: null }));
        const [currentScores, setCurrentScores] = useState(initialScores.filter(s => s !== null)); // Filter out nulls from previous saves

        const handleSetScoreChange = (setIndex, teamKey, value) => {
            const newScores = [...currentScores];
            if (!newScores[setIndex]) {
                newScores[setIndex] = { team1Games: '', team2Games: '', tiebreaker: null };
            }
            newScores[setIndex][teamKey] = value === '' ? '' : Number(value);
            setCurrentScores(newScores);
        };

        const handleTiebreakerScoreChange = (setIndex, teamKey, value) => {
            const newScores = [...currentScores];
            if (!newScores[setIndex].tiebreaker) {
                newScores[setIndex].tiebreaker = { team1Points: '', team2Points: '' };
            }
            newScores[setIndex].tiebreaker[teamKey] = value === '' ? '' : Number(value);
            setCurrentScores(newScores);
        };

        // Determine if a set should show tiebreaker inputs
        const shouldShowTiebreakerInput = (setIndex) => {
            const set = currentScores[setIndex];
            if (!set) return false;
            return set.team1Games === config.tiebreakerScoreThreshold && set.team2Games === config.tiebreakerScoreThreshold;
        };

        // Validate individual set scores as they are entered (for live feedback)
        const validateSet = (setIndex) => {
            const set = currentScores[setIndex];
            if (!set || set.team1Games === '' || set.team2Games === '') return '';

            const t1Games = Number(set.team1Games);
            const t2Games = Number(set.team2Games);

            // Check for standard win condition
            const t1WinsStandard = t1Games >= config.gamesToWinSet && t1Games - t2Games >= 2;
            const t2WinsStandard = t2Games >= config.gamesToWinSet && t2Games - t1Games >= 2;

            // Check for tiebreaker condition
            const isTiebreakerTriggered = (t1Games === config.tiebreakerScoreThreshold && t2Games === config.tiebreakerScoreThreshold);

            if (isTiebreakerTriggered) {
                const t1Tie = Number(set.tiebreaker?.team1Points);
                const t2Tie = Number(set.tiebreaker?.team2Points);

                if (set.tiebreaker === null || t1Tie === '' || t2Tie === '') {
                    return `Enter tiebreaker score (first to ${config.tiebreakerPointsToWin} by ${config.tiebreakerMinWinDifference}).`;
                }

                const t1WinsTiebreaker = t1Tie >= config.tiebreakerPointsToWin && t1Tie - t2Tie >= config.tiebreakerMinWinDifference;
                const t2WinsTiebreaker = t2Tie >= config.tiebreakerPointsToWin && t2Tie - t1Tie >= config.tiebreakerMinWinDifference;

                if (!(t1WinsTiebreaker || t2WinsTiebreaker)) {
                    return `Tiebreaker must be won by at least ${config.tiebreakerMinWinDifference} points and reach ${config.tiebreakerPointsToWin} points.`;
                }
            } else if (!(t1WinsStandard || t2WinsStandard)) {
                // If not a tiebreaker, must be a standard win
                return `One team must reach ${config.gamesToWinSet} games and win by at least 2.`;
            }
            return ''; // No error
        };

        // Calculate current sets won for displaying which team is leading
        let currentTeam1SetsWon = 0;
        let currentTeam2SetsWon = 0;

        currentScores.forEach((set, index) => {
            const validationMessage = validateSet(index);
            if (validationMessage === '') { // Only count if set is valid
                const t1Games = Number(set.team1Games);
                const t2Games = Number(set.team2Games);
                const t1Tie = Number(set.tiebreaker?.team1Points);
                const t2Tie = Number(set.tiebreaker?.team2Points);

                const isTiebreakerSet = (t1Games === config.tiebreakerScoreThreshold && t2Games === config.tiebreakerScoreThreshold);

                if (isTiebreakerSet) {
                    if (t1Tie > t2Tie && t1Tie >= config.tiebreakerPointsToWin && t1Tie - t2Tie >= config.tiebreakerMinWinDifference) currentTeam1SetsWon++;
                    else if (t2Tie > t1Tie && t2Tie >= config.tiebreakerPointsToWin && t2Tie - t1Tie >= config.tiebreakerMinWinDifference) currentTeam2SetsWon++;
                } else if (t1Games > t2Games && t1Games >= config.gamesToWinSet && t1Games - t2Games >= 2) {
                    currentTeam1SetsWon++;
                } else if (t2Games > t1Games && t2Games >= config.gamesToWinSet && t2Games - t1Games >= 2) {
                    currentTeam2SetsWon++;
                }
            }
        });

        // Determines if enough sets have been played for one team to win the match
        const isMatchOver = currentTeam1SetsWon === config.setsToWinMatch || currentTeam2SetsWon === config.setsToWinMatch;

        // Determine how many sets to show based on current state
        const getNumberOfSetsToShow = () => {
            // If there are existing scores (editing mode), show at least as many sets as we have data for
            const existingSets = currentScores.filter(set => set && (set.team1Games !== '' || set.team2Games !== '')).length;
            
            // Always show at least enough sets for a minimum match (setsToWinMatch sets)
            // Plus one additional set for the next potential set, unless the match is already complete
            const minSetsToShow = isMatchOver ? existingSets : Math.max(existingSets + 1, config.setsToWinMatch);
            
            // Never show more than the maximum possible sets for this match format
            const maxPossibleSets = config.setsToWinMatch * 2 - 1;
            
            return Math.min(minSetsToShow, maxPossibleSets);
        };

        // Filter scores to only include valid, completed sets for saving
        const getValidScoresToSave = () => {
            const validScores = [];
            let t1Sets = 0;
            let t2Sets = 0;

            for (let i = 0; i < currentScores.length; i++) {
                const set = currentScores[i];
                if (!set || set.team1Games === '' || set.team2Games === '') break; // Stop if an incomplete set is found
                const validationMessage = validateSet(i);
                if (validationMessage !== '') break; // Stop if an invalid set is found

                validScores.push(set);

                // Count sets won to check if match is over
                const t1Games = Number(set.team1Games);
                const t2Games = Number(set.team2Games);
                const t1Tie = Number(set.tiebreaker?.team1Points);
                const t2Tie = Number(set.tiebreaker?.team2Points);
                const isTiebreakerSet = (t1Games === config.tiebreakerScoreThreshold && t2Games === config.tiebreakerScoreThreshold);

                if (isTiebreakerSet) {
                    if (t1Tie > t2Tie && t1Tie >= config.tiebreakerPointsToWin && t1Tie - t2Tie >= config.tiebreakerMinWinDifference) t1Sets++;
                    else if (t2Tie > t1Tie && t2Tie >= config.tiebreakerPointsToWin && t2Tie - t1Tie >= config.tiebreakerMinWinDifference) t2Sets++;
                } else if (t1Games > t2Games && t1Games >= config.gamesToWinSet && t1Games - t2Games >= 2) {
                    t1Sets++;
                } else if (t2Games > t1Games && t2Games >= config.gamesToWinSet && t2Games - t1Games >= 2) {
                    t2Sets++;
                }

                if (t1Sets === config.setsToWinMatch || t2Sets === config.setsToWinMatch) {
                    break; // Match is over, no more sets to consider
                }
            }
            return validScores;
        };

        const handleSave = () => {
            const scoresToSave = getValidScoresToSave();
            if (scoresToSave.length === 0) {
                setMessageAndScroll({ text: "Please enter at least one valid set score.", type: "error" });
                return;
            }

            let t1FinalSets = 0;
            let t2FinalSets = 0;
            scoresToSave.forEach((set, index) => {
                const t1Games = Number(set.team1Games);
                const t2Games = Number(set.team2Games);
                const t1Tie = Number(set.tiebreaker?.team1Points);
                const t2Tie = Number(set.tiebreaker?.team2Points);
                const isTiebreakerSet = (t1Games === config.tiebreakerScoreThreshold && t2Games === config.tiebreakerScoreThreshold);

                if (isTiebreakerSet) {
                    if (t1Tie > t2Tie) t1FinalSets++; else t2FinalSets++;
                } else if (t1Games > t2Games) {
                    t1FinalSets++;
                } else {
                    t2FinalSets++;
                }
            });

            if (t1FinalSets !== config.setsToWinMatch && t2FinalSets !== config.setsToWinMatch) {
                setMessageAndScroll({ text: `Match is not complete. One team must win ${config.setsToWinMatch} sets.`, type: "error" });
                return;
            }

            onSave(match.id, scoresToSave);
        };

        return (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg space-y-5 rounded-md-lg overflow-y-auto max-h-[90vh]">
                    <h3 className="text-2xl font-bold text-gray-800 text-center">Enter Match Score</h3>
                    <p className="text-gray-700 text-center">
                        Match: {match.date} at {match.time} on {match.court}<br/>
                        <span className="font-semibold">{match.team1Name}</span> vs <span className="font-semibold">{match.team2Name}</span>
                    </p>

                    <div className="space-y-4">
                        {Array.from({ length: getNumberOfSetsToShow() }).map((_, setIndex) => {

                            return (
                                <div key={setIndex} className="bg-gray-100 p-4 rounded-md-lg border border-gray-200">
                                    <p className="font-semibold text-lg text-gray-800 mb-2">Set {setIndex + 1}</p>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label htmlFor={`t1-games-${setIndex}`} className="block text-sm font-medium text-gray-700 mb-1">{match.team1Name} Games</label>
                                            <input
                                                id={`t1-games-${setIndex}`}
                                                type="number"
                                                min="0"
                                                value={currentScores[setIndex]?.team1Games ?? ''}
                                                onChange={(e) => handleSetScoreChange(setIndex, 'team1Games', e.target.value)}
                                                className="w-full input-field"
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor={`t2-games-${setIndex}`} className="block text-sm font-medium text-gray-700 mb-1">{match.team2Name} Games</label>
                                            <input
                                                id={`t2-games-${setIndex}`}
                                                type="number"
                                                min="0"
                                                value={currentScores[setIndex]?.team2Games ?? ''}
                                                onChange={(e) => handleSetScoreChange(setIndex, 'team2Games', e.target.value)}
                                                className="w-full input-field"
                                            />
                                        </div>
                                    </div>
                                    {shouldShowTiebreakerInput(setIndex) && (
                                        <div className="mt-3 bg-yellow-50 p-3 rounded-md-lg border border-yellow-200">
                                            <p className="text-sm font-semibold text-yellow-800 mb-2">Tie-breaker ({config.tiebreakerPointsToWin} points to win by {config.tiebreakerMinWinDifference})</p>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label htmlFor={`t1-tiebreaker-${setIndex}`} className="block text-sm font-medium text-gray-700 mb-1">{match.team1Name} Points</label>
                                                    <input
                                                        id={`t1-tiebreaker-${setIndex}`}
                                                        type="number"
                                                        min="0"
                                                        value={currentScores[setIndex]?.tiebreaker?.team1Points ?? ''}
                                                        onChange={(e) => handleTiebreakerScoreChange(setIndex, 'team1Points', e.target.value)}
                                                        className="w-full input-field"
                                                    />
                                                </div>
                                                <div>
                                                    <label htmlFor={`t2-tiebreaker-${setIndex}`} className="block text-sm font-medium text-gray-700 mb-1">{match.team2Name} Points</label>
                                                    <input
                                                        id={`t2-tiebreaker-${setIndex}`}
                                                        type="number"
                                                        min="0"
                                                        value={currentScores[setIndex]?.tiebreaker?.team2Points ?? ''}
                                                        onChange={(e) => handleTiebreakerScoreChange(setIndex, 'team2Points', e.target.value)}
                                                        className="w-full input-field"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {currentScores[setIndex] && validateSet(setIndex) && (
                                        <p className="text-red-500 text-sm mt-2">{validateSet(setIndex)}</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <p className="text-lg font-bold text-center text-gray-800 mt-4">
                        Current Sets: {currentTeam1SetsWon} ({match.team1Name}) - {currentTeam2SetsWon} ({match.team2Name})
                    </p>

                    <div className="flex justify-end space-x-3">
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors rounded-md-lg"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors rounded-md-lg"
                        >
                            Save Score
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // Helper to format score for display
    const formatScore = (scoreArray) => {
        if (!scoreArray || scoreArray.length === 0) return 'N/A';
        return scoreArray.map(set => {
            if (set.tiebreaker) {
                return `${set.team1Games}-${set.team2Games}(${set.tiebreaker.team1Points}-${set.tiebreaker.team2Points})`;
            }
            return `${set.team1Games}-${set.team2Games}`;
        }).join(', ');
    };

    // Message Display Component
    const MessageDisplay = ({ messageData, onClose }) => {
        if (!messageData || !messageData.text) return null;

        let bgColor = '';
        let textColor = '';
        let title = '';

        switch (messageData.type) {
            case 'success':
                bgColor = 'bg-green-100';
                textColor = 'text-green-700';
                title = 'Success!';
                break;
            case 'error':
                bgColor = 'bg-red-100';
                textColor = 'text-red-700';
                title = 'Error!';
                break;
            case 'info':
                bgColor = 'bg-blue-100';
                textColor = 'text-blue-700';
                title = 'Info';
                break;
            case 'analysis':
                bgColor = 'bg-yellow-100';
                textColor = 'text-yellow-800';
                title = 'AI Analysis';
                break;
            default:
                bgColor = 'bg-gray-100';
                textColor = 'text-gray-700';
                title = 'Notification';
        }

        // Simple Markdown to HTML conversion for newlines and bolding (if present)
        // For more complex Markdown, a dedicated library would be needed.
        const formatMarkdown = (text) => {
            if (!text) return { __html: '' };
            // Replace newlines with <br/> tags
            let htmlText = text.replace(/\n/g, '<br/>');
            // Basic bolding: **text** to <strong>text</strong>
            htmlText = htmlText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            return { __html: htmlText };
        };


        return (
            <div className={`mt-4 p-4 rounded-md-lg shadow-md ${bgColor} ${textColor} relative`}>
                <h3 className="font-bold mb-2">{title}</h3>
                <p className="text-sm" dangerouslySetInnerHTML={formatMarkdown(messageData.text)}></p>
                <button
                    onClick={onClose}
                    className="absolute top-2 right-2 text-lg font-bold text-gray-500 hover:text-gray-700"
                    aria-label="Dismiss message"
                >
                    &times;
                </button>
            </div>
        );
    };


    // Render the main content based on state
    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-100 to-purple-100 flex flex-col items-center justify-center p-4 font-inter">
            {/* Tailwind CSS CDN */}
            <script src="https://cdn.tailwindcss.com"></script>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

            <style>
                {`
                body {
                    font-family: 'Inter', sans-serif;
                }
                .rounded-md-lg {
                    border-radius: 0.75rem; /* More rounded corners */
                }
                .button-primary {
                    background-color: #4f46e5; /* Indigo 600 */
                    color: white;
                    font-weight: bold;
                    padding: 12px 24px;
                    border-radius: 0.75rem;
                    transition: all 0.3s ease;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                }
                .button-primary:hover {
                    background-color: #4338ca; /* Indigo 700 */
                    transform: translateY(-2px);
                    box-shadow: 0 6px 8px rgba(0, 0, 0, 0.15);
                }
                .button-secondary {
                    background-color: #6b7280; /* Gray 500 */
                    color: white;
                    font-weight: bold;
                    padding: 8px 16px;
                    border-radius: 0.5rem;
                    transition: all 0.3s ease;
                }
                .button-secondary:hover {
                    background-color: #4b5563; /* Gray 600 */
                    transform: translateY(-1px);
                }
                .button-danger {
                    background-color: #dc2626; /* Red 600 */
                    color: white;
                    font-weight: bold;
                    padding: 8px 16px;
                    border-radius: 0.5rem;
                    transition: all 0.3s ease;
                }
                .button-danger:hover {
                    background-color: #b91c1c; /* Red 700 */
                    transform: translateY(-1px);
                }
                .button-gemini { /* New style for Gemini button */
                    background-color: #f9a825; /* Amber 600 */
                    color: #fff;
                    font-weight: bold;
                    padding: 8px 16px;
                    border-radius: 0.5rem;
                    transition: all 0.3s ease;
                }
                .button-gemini:hover {
                    background-color: #f59e0b; /* Amber 500 */
                    transform: translateY(-1px);
                }
                .button-score {
                    background-color: #0d9488; /* Teal 600 */
                    color: white;
                    font-weight: bold;
                    padding: 8px 16px;
                    border-radius: 0.5rem;
                    transition: all 0.3s ease;
                }
                .button-score:hover {
                    background-color: #0f766e; /* Teal 700 */
                    transform: translateY(-1px);
                }
                .input-field {
                    padding: 12px;
                    border: 1px solid #d1d5db; /* Gray 300 */
                    border-radius: 0.75rem;
                    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
                }
                .input-field:focus {
                    outline: none;
                    border-color: #6366f1; /* Indigo 500 */
                    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.3); /* Indigo 500 ring */
                }
                @media print {
                    body > *:not(.printable-container) { /* Hide everything except the printable container */
                        display: none !important;
                    }
                    .printable-container {
                        display: block !important;
                        position: absolute;
                        left: 0;
                        top: 0;
                        width: 100%;
                        margin: 0;
                        padding: 0;
                    }
                    .schedule-table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 10px; /* Adjusted margin */
                    }
                    .schedule-table th, .schedule-table td {
                        border: 1px solid #000; /* Darker borders for print */
                        padding: 6px; /* Reduced padding for print */
                        text-align: left;
                        font-size: 8pt; /* Smaller font for print */
                    }
                    .schedule-table th {
                        background-color: #f2f2f2;
                    }
                    h1 {
                        font-size: 16pt; /* Adjust heading size for print */
                        text-align: center;
                        margin-bottom: 10px;
                    }
                    .print-info {
                        font-size: 10pt;
                        text-align: center;
                        margin-bottom: 10px;
                    }
                    .match-details p {
                        margin: 0;
                        line-height: 1.1; /* Tighter line height for print */
                    }
                    .match-details .font-semibold {
                        font-weight: 600;
                    }
                    .line-through {
                        text-decoration: line-through;
                    }
                    .text-red-600 {
                        color: #dc2626;
                    }
                    .text-green-600 {
                        color: #16a34a;
                    }
                }
                `}
            </style>

            {/* Confirmation Modals */}
            <ConfirmationModal
                show={showClearDataConfirm}
                title="Confirm Clear All Data"
                message="Are you sure you want to clear ALL players, teams, matches, and substitute players? This action cannot be undone."
                onConfirm={handleClearAllData}
                onCancel={() => setShowClearDataConfirm(false)}
            />

            <ConfirmationModal
                show={matchToCancel !== null}
                title="Confirm Cancellation"
                message={`Are you sure you want to cancel the match on ${matchToCancel?.date} at ${matchToCancel?.time} on ${matchToCancel?.court}?`}
                onConfirm={handleCancelMatch}
                onCancel={() => setMatchToCancel(null)}
            />

            {/* Substitution Modal */}
            <SubstitutePlayerModal
                show={showSubstituteModal}
                match={selectedMatchForSubstitution}
                substitutePlayers={substitutePlayers}
                onConfirm={handleConfirmSubstitution}
                onCancel={() => setShowSubstituteModal(false)}
                playerToSubstituteKey={playerToSubstituteKey}
                setPlayerToSubstituteKey={setPlayerToSubstituteKey}
                selectedSubstituteId={selectedSubstituteId}
                setSelectedSubstituteId={setSelectedSubstituteId}
            />

            {/* Score Entry Modal */}
            <ScoreEntryModal
                show={showScoreEntryModal}
                match={matchForScoreEntry}
                config={{ gamesToWinSet, setsToWinMatch, tiebreakerScoreThreshold, tiebreakerPointsToWin, tiebreakerMinWinDifference }}
                onSave={handleSaveScore}
                onCancel={() => {
                    setShowScoreEntryModal(false);
                    setMatchForScoreEntry(null);
                    setMessageAndScroll({ text: null, type: null }); // Clear any validation messages from the score modal
                }}
            />

            <div className="w-full max-w-5xl bg-white rounded-xl shadow-2xl p-8 space-y-8 rounded-md-lg printable-container"> {/* Added printable-container class */}
                <h1 className="text-4xl font-extrabold text-center text-gray-900">
                    Tennis Round Robin Tournament
                </h1>
                {userId && (
                    <div className="text-center text-sm font-medium text-blue-700 bg-blue-100 px-4 py-2 rounded-md-lg shadow-inner print-hide">
                        Current User ID: {userId}
                    </div>
                )}

                {/* Message Display Area */}
                <MessageDisplay messageData={message} onClose={() => setMessageAndScroll({ text: null, type: null })} />

                {/* Tournament Configuration Section (New Step 1) */}
                <div className="bg-gray-50 p-6 rounded-xl shadow-inner space-y-6 rounded-md-lg print-hide">
                    <h2 className="text-2xl font-bold text-gray-800 text-center">1. Tournament Configuration</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label htmlFor="total-players" className="block text-sm font-medium text-gray-700 mb-1">Total Players</label>
                            <input
                                id="total-players"
                                type="number"
                                placeholder="e.g., 20"
                                value={totalPlayersCount}
                                onChange={(e) => {
                                    const value = Number(e.target.value);
                                    if (value >= 0) { // Allow 0 temporarily for input, validate later
                                        setTotalPlayersCount(value);
                                        // Dynamically resize playerInputs array
                                        setPlayerInputs(Array(value).fill({ name: '', handicap: '' }));
                                    }
                                }}
                                className="w-full input-field"
                                min="2" // Minimum 2 players to start
                                step="2" // Suggest even numbers for doubles
                            />
                            {!isTotalPlayersEven && totalPlayersCount > 0 && (
                                <p className="text-red-500 text-xs mt-1">Total players must be an even number for doubles.</p>
                            )}
                            {totalPlayersCount < 2 && totalPlayersCount > 0 && (
                                <p className="text-red-500 text-xs mt-1">Minimum 2 players required.</p>
                            )}
                        </div>
                        <div>
                            <label htmlFor="courts-per-day" className="block text-sm font-medium text-gray-700 mb-1">Courts Per Day</label>
                            <input
                                id="courts-per-day"
                                type="number"
                                placeholder="e.g., 5"
                                value={courtsPerDayCount}
                                onChange={(e) => {
                                    const value = Number(e.target.value);
                                    if (value > 0) setCourtsPerDayCount(value);
                                }}
                                className="w-full input-field"
                                min="1"
                            />
                        </div>
                        <div>
                            <label htmlFor="tournament-duration" className="block text-sm font-medium text-gray-700 mb-1">Tournament Duration (Days)</label>
                            <input
                                id="tournament-duration"
                                type="number"
                                placeholder="e.g., 18"
                                value={tournamentDurationDays}
                                onChange={(e) => {
                                    const value = Number(e.target.value);
                                    if (value > 0) setTournamentDurationDays(value);
                                }}
                                className="w-full input-field"
                                min="1"
                            />
                        </div>
                    </div>

                    <h3 className="text-xl font-bold text-gray-800 text-center mt-6">Scoring Rules</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label htmlFor="games-to-win-set" className="block text-sm font-medium text-gray-700 mb-1">Games to Win Set</label>
                            <input
                                id="games-to-win-set"
                                type="number"
                                placeholder="e.g., 6"
                                value={gamesToWinSet}
                                onChange={(e) => setGamesToWinSet(Number(e.target.value))}
                                className="w-full input-field"
                                min="1"
                            />
                        </div>
                        <div>
                            <label htmlFor="sets-to-win-match" className="block text-sm font-medium text-gray-700 mb-1">Sets to Win Match</label>
                            <input
                                id="sets-to-win-match"
                                type="number"
                                placeholder="e.g., 2 (for best of 3)"
                                value={setsToWinMatch}
                                onChange={(e) => setSetsToWinMatch(Number(e.target.value))}
                                className="w-full input-field"
                                min="1"
                            />
                        </div>
                        <div>
                            <label htmlFor="tiebreaker-threshold" className="block text-sm font-medium text-gray-700 mb-1">Tiebreaker Threshold (Games)</label>
                            <input
                                id="tiebreaker-threshold"
                                type="number"
                                placeholder="e.g., 6"
                                value={tiebreakerScoreThreshold}
                                onChange={(e) => setTiebreakerScoreThreshold(Number(e.target.value))}
                                className="w-full input-field"
                                min="0"
                            />
                        </div>
                        <div>
                            <label htmlFor="tiebreaker-points-win" className="block text-sm font-medium text-gray-700 mb-1">Tiebreaker Points to Win</label>
                            <input
                                id="tiebreaker-points-win"
                                type="number"
                                placeholder="e.g., 7"
                                value={tiebreakerPointsToWin}
                                onChange={(e) => setTiebreakerPointsToWin(Number(e.target.value))}
                                className="w-full input-field"
                                min="1"
                            />
                        </div>
                        <div>
                            <label htmlFor="tiebreaker-min-diff" className="block text-sm font-medium text-gray-700 mb-1">Tiebreaker Min. Difference</label>
                            <input
                                id="tiebreaker-min-diff"
                                type="number"
                                placeholder="e.g., 2"
                                value={tiebreakerMinWinDifference}
                                onChange={(e) => setTiebreakerMinWinDifference(Number(e.target.value))}
                                className="w-full input-field"
                                min="1"
                            />
                        </div>
                    </div>
                </div>

                {/* Player Input Section */}
                <div className="bg-gray-50 p-6 rounded-xl shadow-inner space-y-6 rounded-md-lg print-hide">
                    <h2 className="text-2xl font-bold text-gray-800 text-center">2. Enter Player Names and Handicaps ({totalPlayersCount} Players)</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {Array.from({ length: totalPlayersCount }).map((_, index) => (
                            <div key={index} className="flex flex-col">
                                <label htmlFor={`player-name-${index}`} className="text-sm font-medium text-gray-700 mb-1">Player {index + 1} Name</label>
                                <input
                                    id={`player-name-${index}`}
                                    type="text"
                                    placeholder={`Player ${index + 1} Name`}
                                    value={playerInputs[index] ? playerInputs[index].name : ''}
                                    onChange={(e) => handlePlayerInputChange(index, 'name', e.target.value)}
                                    className="w-full input-field mb-2"
                                />
                                <label htmlFor={`player-handicap-${index}`} className="text-sm font-medium text-gray-700 mb-1">Handicap</label>
                                <input
                                    id={`player-handicap-${index}`}
                                    type="number"
                                    placeholder="Handicap (e.g., 5)"
                                    value={playerInputs[index] ? playerInputs[index].handicap : ''}
                                    onChange={(e) => handlePlayerInputChange(index, 'handicap', e.target.value)}
                                    className="w-full input-field"
                                    min="0" // Assuming non-negative handicaps
                                />
                            </div>
                        ))}
                    </div>
                    <button
                        onClick={addPlayersToFirestore}
                        className="button-primary w-full"
                        disabled={!isAuthReady || loadingData || !isTotalPlayersEven || totalPlayersCount < 2}
                    >
                        {loadingData ? 'Loading...' : `Add/Update ${totalPlayersCount} Players`}
                    </button>
                    {players.length > 0 && (
                        <div className="text-sm text-gray-600 text-center mt-2">
                            {players.length} players currently stored.
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 mt-2">
                                {players.map(p => (
                                    <span key={p.id} className="bg-blue-50 text-blue-800 px-2 py-1 rounded-full text-xs font-semibold">
                                        {p.name} ({p.handicap})
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Substitute Player Section */}
                <div className="bg-gray-50 p-6 rounded-xl shadow-inner space-y-6 rounded-md-lg print-hide">
                    <h2 className="text-2xl font-bold text-gray-800 text-center">3. Add Substitute Players</h2>
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex-grow">
                            <label htmlFor="sub-name" className="text-sm font-medium text-gray-700 mb-1">Substitute Name</label>
                            <input
                                id="sub-name"
                                type="text"
                                placeholder="Substitute Player Name"
                                value={newSubstituteName}
                                onChange={(e) => setNewSubstituteName(e.target.value)}
                                className="w-full input-field mb-2"
                            />
                        </div>
                        <div className="flex-grow">
                            <label htmlFor="sub-handicap" className="text-sm font-medium text-gray-700 mb-1">Handicap</label>
                            <input
                                id="sub-handicap"
                                type="number"
                                placeholder="Handicap (e.g., 6)"
                                value={newSubstituteHandicap}
                                onChange={(e) => setNewSubstituteHandicap(e.target.value)}
                                className="w-full input-field"
                                min="0"
                            />
                        </div>
                    </div>
                    <button
                        onClick={handleAddSubstitutePlayer}
                        className="button-primary w-full"
                        disabled={!isAuthReady || loadingData}
                    >
                        {loadingData ? 'Loading...' : 'Add Substitute Player'}
                    </button>
                    {substitutePlayers.length > 0 && (
                        <div className="text-sm text-gray-600 text-center mt-2">
                            {substitutePlayers.length} substitute(s) available.
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 mt-2">
                                {substitutePlayers.map(p => (
                                    <span key={p.id} className="bg-purple-50 text-purple-800 px-2 py-1 rounded-full text-xs font-semibold">
                                        {p.name} ({p.handicap})
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>


                {/* Team Generation Section */}
                <div className="bg-gray-50 p-6 rounded-xl shadow-inner space-y-6 rounded-md-lg print-hide">
                    <h2 className="text-2xl font-bold text-gray-800 text-center">4. Generate Doubles Teams ({numberOfTeams} Teams)</h2>
                    <p className="text-center text-gray-600">
                        Teams are formed by pairing stronger players with weaker players to balance handicaps, aiming for competitive matches.
                    </p>
                    <button
                        onClick={generateTeams}
                        className="button-primary w-full"
                        disabled={!isAuthReady || loadingData || players.length !== totalPlayersCount || !isTotalPlayersEven || totalPlayersCount < 2}
                    >
                        {loadingData ? 'Loading...' : `Generate ${numberOfTeams} Balanced Teams`}
                    </button>
                    {teams.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                            {teams.map(team => (
                                <div key={team.id} className="bg-white p-4 rounded-md-lg shadow-sm border border-gray-200">
                                    <p className="font-semibold text-lg text-gray-800">{team.name} (Total Handicap: {team.teamHandicapSum})</p>
                                    <p className="text-gray-700">
                                        Players: {team.player1Name} ({team.player1Handicap}) & {team.player2Name} ({team.player2Handicap})
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Schedule Generation Section */}
                <div className="bg-gray-50 p-6 rounded-xl shadow-inner space-y-6 rounded-md-lg print-hide">
                    <h2 className="text-2xl font-bold text-gray-800 text-center">5. Generate Multi-Day Schedule</h2>
                    <button
                        onClick={generateSchedule}
                        className="button-primary w-full"
                        disabled={!isAuthReady || loadingData || teams.length !== numberOfTeams || courtsPerDayCount <= 0 || tournamentDurationDays <= 0}
                    >
                        {loadingData ? 'Loading...' : 'Generate Schedule'}
                    </button>
                </div>

                {/* Tournament Schedule Display */}
                <div className="bg-gray-50 p-6 rounded-xl shadow-inner space-y-6 rounded-md-lg">
                    <h2 className="text-2xl font-bold text-gray-800 text-center">6. Tournament Schedule</h2>
                    <div className="flex items-center justify-between mb-4 print-hide">
                        <label htmlFor="showMyMatches" className="text-sm font-medium text-gray-700 flex items-center">
                            <input
                                type="checkbox"
                                id="showMyMatches"
                                checked={showMyMatchesOnly}
                                onChange={(e) => setShowMyMatchesOnly(e.target.checked)}
                                className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                            />
                            Show My Created Matches Only
                        </label>
                        <div className="flex space-x-2">
                            <button
                                onClick={handleGetTournamentInsights}
                                className="button-gemini"
                                disabled={gettingTournamentInsights || matches.length === 0}
                            >
                                {gettingTournamentInsights ? 'Getting Insights...' : '✨ Get Tournament Insights'}
                            </button>
                            <button
                                onClick={handlePrintSchedule}
                                className="button-secondary"
                            >
                                Print Schedule
                            </button>
                        </div>
                    </div>
                    {loadingData ? (
                        <p className="text-center text-gray-600">Loading schedule...</p>
                    ) : filteredMatches.length === 0 ? (
                        <p className="text-center text-gray-600">No matches scheduled yet or no matches match your filter. Generate a schedule above!</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 shadow-md rounded-md-lg schedule-table">
                                <thead className="bg-blue-600 rounded-t-lg">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider rounded-tl-lg">
                                            Date
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                                            Time
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                                            Court
                                        </th>
                                        <th scope="col" className="min-w-[200px] px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                                            Match
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                                            Score
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                                            Winner
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                                            Status
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-white uppercase tracking-wider rounded-tr-lg print-hide">
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {filteredMatches.map((match) => (
                                        <tr key={match.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 rounded-md-lg">
                                                {match.date}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 rounded-md-lg">
                                                {match.time}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 rounded-md-lg">
                                                {match.court}
                                            </td>
                                            <td className="min-w-[200px] px-6 py-4 whitespace-nowrap text-sm text-gray-700 rounded-md-lg match-details">
                                                <p className="font-semibold">{match.team1Name} (
                                                    {match.substituteInfo && match.substituteInfo.affectedTeamKey === 'team1' ?
                                                        <>
                                                            <span className="line-through">{match.substituteInfo.originalPlayerName}</span> &rarr; {match.substituteInfo.substitutePlayerName}
                                                        </> :
                                                        `${match.team1OriginalPlayer1Name}, ${match.team1OriginalPlayer2Name}`
                                                    }
                                                ) vs </p>
                                                <p className="font-semibold">{match.team2Name} (
                                                    {match.substituteInfo && match.substituteInfo.affectedTeamKey === 'team2' ?
                                                        <>
                                                            <span className="line-through">{match.substituteInfo.originalPlayerName}</span> &rarr; {match.substituteInfo.substitutePlayerName}
                                                        </> :
                                                        `${match.team2OriginalPlayer1Name}, ${match.team2OriginalPlayer2Name}`
                                                    }
                                                )</p>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 rounded-md-lg">
                                                {formatScore(match.score)}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 rounded-md-lg">
                                                {match.winnerTeamId ? teams.find(t => t.id === match.winnerTeamId)?.name : 'N/A'}
                                            </td>
                                            <td className={`px-6 py-4 whitespace-nowrap text-sm font-semibold rounded-md-lg ${
                                                match.status === 'cancelled' ? 'text-red-600' : (match.status === 'completed' ? 'text-green-600' : 'text-blue-600')
                                            }`}>
                                                {match.status ? match.status.charAt(0).toUpperCase() + match.status.slice(1) : 'Scheduled'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2 rounded-md-lg print-hide">
                                                {match.status === 'scheduled' && ( // Only allow actions for scheduled matches
                                                    <>
                                                        <button
                                                            onClick={() => {
                                                                setMatchForScoreEntry(match);
                                                                setShowScoreEntryModal(true);
                                                            }}
                                                            className="button-score"
                                                        >
                                                            Enter Score
                                                        </button>
                                                        <button
                                                            onClick={() => handleAnalyzeMatch(match)}
                                                            className="button-gemini"
                                                            disabled={analyzingMatchId === match.id} // Disable if currently analyzing this match
                                                        >
                                                            {analyzingMatchId === match.id ? 'Analyzing...' : '✨ Analyze Match'}
                                                        </button>
                                                        <button
                                                            onClick={() => handleOpenSubstituteModal(match)}
                                                            className="button-secondary"
                                                        >
                                                            Substitute
                                                        </button>
                                                        <button
                                                            onClick={() => setMatchToCancel(match)}
                                                            className="button-danger"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </>
                                                )}
                                                {match.status === 'completed' && (
                                                    <>
                                                        <button
                                                            onClick={() => handleAnalyzeMatch(match)}
                                                            className="button-gemini"
                                                            disabled={analyzingMatchId === match.id}
                                                        >
                                                            {analyzingMatchId === match.id ? 'Analyzing...' : '✨ Analyze Match'}
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                setMatchForScoreEntry(match);
                                                                setShowScoreEntryModal(true);
                                                            }}
                                                            className="button-score"
                                                        >
                                                            Edit Score
                                                        </button>
                                                    </>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Tournament Results & Standings Section (New) */}
                <div className="bg-gray-50 p-6 rounded-xl shadow-inner space-y-6 rounded-md-lg">
                    <h2 className="text-2xl font-bold text-gray-800 text-center">7. Tournament Results & Standings</h2>

                    {matches.filter(m => m.status === 'completed').length === 0 ? (
                        <p className="text-center text-gray-600">No completed matches yet. Enter scores to see standings.</p>
                    ) : (
                        <>
                            {/* Player Statistics */}
                            <div className="mt-8">
                                <h3 className="text-xl font-bold text-gray-800 text-center mb-4">Player Statistics</h3>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200 shadow-md rounded-md-lg">
                                        <thead className="bg-blue-500">
                                            <tr>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider rounded-tl-lg">
                                                    Player
                                                </th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                                                    Handicap
                                                </th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                                                    Matches Played
                                                </th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                                                    Wins
                                                </th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                                                    Losses
                                                </th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                                                    Win %
                                                </th>
                                                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-white uppercase tracking-wider rounded-tr-lg">
                                                    Actions
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                            {calculateStats.sortedPlayers.map(p => (
                                                <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{p.name}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{p.handicap}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{p.matchesPlayed}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-700 font-semibold">{p.wins}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-700 font-semibold">{p.losses}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold">{p.winRate}%</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                        <button
                                                            onClick={() => handleGetPlayerPerformanceInsights(p)}
                                                            className="button-gemini"
                                                            disabled={analyzingPlayerId === p.id || p.matchesPlayed === 0}
                                                        >
                                                            {analyzingPlayerId === p.id ? 'Analyzing...' : '✨ Get Insights'}
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Team Standings */}
                            <div className="mt-8">
                                <h3 className="text-xl font-bold text-gray-800 text-center mb-4">Team Standings</h3>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200 shadow-md rounded-md-lg">
                                        <thead className="bg-blue-500">
                                            <tr>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider rounded-tl-lg">
                                                    Team Name
                                                </th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                                                    Handicap Sum
                                                </th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                                                    Matches Played
                                                </th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                                                    Wins
                                                </th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                                                    Losses
                                                </th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider rounded-tr-lg">
                                                    Win %
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                            {calculateStats.sortedTeams.map(t => (
                                                <tr key={t.name} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{t.name}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{t.handicapSum}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{t.matchesPlayed}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-700 font-semibold">{t.wins}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-700 font-semibold">{t.losses}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold">{t.winRate}%</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Optimal Pairings Section (New) */}
                            <div className="mt-8">
                                <h3 className="text-xl font-bold text-gray-800 text-center mb-4">Player Pairing Optimization</h3>
                                <div className="flex justify-center">
                                    <button
                                        onClick={handleGetOptimalPairings}
                                        className="button-gemini py-3 px-6"
                                        disabled={gettingOptimalPairings || players.length === 0 || players.length % 2 !== 0}
                                    >
                                        {gettingOptimalPairings ? 'Getting Suggestions...' : '✨ Suggest Optimal Pairings'}
                                    </button>
                                </div>
                                {(players.length > 0 && players.length % 2 !== 0) && (
                                    <p className="text-red-500 text-xs mt-2 text-center">Cannot suggest doubles pairings with an odd number of players.</p>
                                )}
                            </div>

                        </>
                    )}
                </div>

                {/* Admin/Clear Data Section */}
                <div className="bg-gray-50 p-6 rounded-xl shadow-inner space-y-4 rounded-md-lg print-hide">
                    <h2 className="text-2xl font-bold text-gray-800 text-center">Admin Actions</h2>
                    <button
                        onClick={() => setShowClearDataConfirm(true)}
                        className="button-danger w-full py-3 px-4 rounded-md-lg"
                        disabled={!isAuthReady || loadingData}
                    >
                        {loadingData ? 'Loading...' : 'Clear All Tournament Data'}
                    </button>
                    <p className="text-sm text-gray-500 text-center">
                        (This will delete all players, teams, matches, and substitute players from the database.)
                    </p>
                </div>
            </div>
          <footer className="m-2">
            <a href="https://github.com/twitter/twemoji" target="_blank" rel="noopener noreferrer" title="tennis icons" className="text-xs text-blue-600 hover:underline">Tennis favicon created by Twemoji</a>
          </footer>
        </div>
    );
};

export default App;

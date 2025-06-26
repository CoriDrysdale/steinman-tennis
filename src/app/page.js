"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, getDocs, query, onSnapshot, serverTimestamp, doc, deleteDoc, updateDoc, getDoc } from 'firebase/firestore';
import { getAnalytics, logEvent } from 'firebase/analytics';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Default Firebase configuration for local development.
const defaultFirebaseConfig = {
    apiKey: "AIzaSyDeJgR3UB4pTp6HChBytGlrdc1ej1kV7kc",
    authDomain: "steinman-tennis.firebaseapp.com",
    projectId: "steinman-tennis",
    storageBucket: "steinman-tennis.firebasestorage.app",
    messagingSenderId: "590586540046",
    appId: "1:590586540046:web:264ab89a69bc11ed314c5f",
    measurementId: "G-5M5NKM84SE"
};

let firebaseConfigToUse = { ...defaultFirebaseConfig };
if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    try {
        const canvasConfig = JSON.parse(__firebase_config);
        firebaseConfigToUse = { ...firebaseConfigToUse, ...canvasConfig };
    } catch (e) {
        console.error("Error parsing __firebase_config from Canvas, using default:", e);
    }
}

const resolvedAppId = typeof __app_id !== 'undefined' ? __app_id : firebaseConfigToUse.appId;
if (resolvedAppId) {
    firebaseConfigToUse.appId = resolvedAppId;
}

const geminiApiKey = typeof __api_key !== 'undefined' ? __api_key : 'AIzaSyCCjpPj4Nz8b24xrYN69Fc36SLhJZc2dDg';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

let firebaseAppInstance;
let firestoreDbInstance;
let firebaseAuthInstance;
let firebaseAnalyticsInstance;

const App = () => {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    // User Role Management
    const [userRole, setUserRole] = useState('player'); // Default to 'player'
    const [isLoadingRole, setIsLoadingRole] = useState(true);

    // Tournament Configuration States
    const [totalPlayersCount, setTotalPlayersCount] = useState(20);
    const [courtsPerDayCount, setCourtsPerDayCount] = useState(5);
    const [tournamentDurationDays, setTournamentDurationDays] = useState(18);

    // Score Configuration States
    const [gamesToWinSet] = useState(6);
    const [setsToWinMatch] = useState(2);
    const [tiebreakerScoreThreshold] = useState(6);
    // const [tiebreakerPointsToWin] = useState(7); // Not currently used in logic, but could be for future
    // const [tiebreakerMinWinDifference] = useState(2); // Not currently used in logic, but could be for future

    // Player, Team, Match Data
    const [playerInputs, setPlayerInputs] = useState(Array(20).fill({ name: '', handicap: '' }));
    const [players, setPlayers] = useState([]);
    const [substitutePlayers, setSubstitutePlayers] = useState([]);
    const [newSubstituteName, setNewSubstituteName] = useState('');
    const [newSubstituteHandicap, setNewSubstituteHandicap] = useState('');
    const [teams, setTeams] = useState([]);
    const [matches, setMatches] = useState([]);
    const [filteredMatches, setFilteredMatches] = useState([]);
    const [teamStandings, setTeamStandings] = useState([]);

    // UI Feedback
    const [message, setMessage] = useState({ text: null, type: null });
    const [loadingData, setLoadingData] = useState(true);

    // AI Features
    const [aiAnalysisResult, setAiAnalysisResult] = useState(null);
    const [showAiAnalysisModal, setShowAiAnalysisModal] = useState(false);
    const [isGeneratingAnalysis, setIsGeneratingAnalysis] = useState(false);
    const [optimalPairingsResult, setOptimalPairingsResult] = useState(null);
    const [showOptimalPairingsModal, setShowOptimalPairingsModal] = useState(false);
    const [gettingOptimalPairings, setGettingOptimalPairings] = useState(false);

    // Modals
    const [showClearDataConfirm, setShowClearDataConfirm] = useState(false);
    const [matchToCancel, setMatchToCancel] = useState(null);
    const [showSubstituteModal, setShowSubstituteModal] = useState(false);
    const [selectedMatchForSubstitution, setSelectedMatchForSubstitution] = useState(null);
    const [playerToSubstituteKey, setPlayerToSubstituteKey] = useState('');
    const [selectedSubstituteId, setSelectedSubstituteId] = useState('');
    const [showScoreEntryModal, setShowScoreEntryModal] = useState(false);
    const [matchForScoreEntry, setMatchForScoreEntry] = useState(null);
    const [scoreInput, setScoreInput] = useState({ team1Sets: [], team2Sets: [] });
    const [currentSetScores, setCurrentSetScores] = useState({ team1Games: '', team2Games: '' });

    const [showMyMatchesOnly, setShowMyMatchesOnly] = useState(false);

    const isFirebaseInitialized = useRef(false);

    const numberOfTeams = useMemo(() => totalPlayersCount / 2, [totalPlayersCount]);
    const isTotalPlayersEven = totalPlayersCount % 2 === 0;

    // --- Helper Functions ---
    const setMessageAndScroll = useCallback((msg) => {
        setMessage(msg);
        if (msg.type !== null && msg.type !== 'success') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, []);

    const logAnalyticsEvent = useCallback((eventName, eventParams = {}) => {
        if (firebaseAnalyticsInstance) {
            logEvent(firebaseAnalyticsInstance, eventName, eventParams);
            console.log(`Analytics Event Logged: ${eventName}`, eventParams);
        } else {
            console.warn("Firebase Analytics not initialized, cannot log event:", eventName);
        }
    }, []);

    const escapeMarkdown = useCallback((text) => {
        if (typeof text !== 'string') return text;
        return text.replace(/([_*`~])/g, '\\$1');
    }, []);

    const calculateMatchWinner = useCallback((team1Sets, team2Sets) => {
        let team1SetWins = 0;
        let team2SetWins = 0;

        for (let i = 0; i < team1Sets.length; i++) {
            const t1Games = parseInt(team1Sets[i]);
            const t2Games = parseInt(team2Sets[i]);

            if (isNaN(t1Games) || isNaN(t2Games)) {
                return null;
            }

            if (t1Games > t2Games) {
                team1SetWins++;
            } else if (t2Games > t1Games) {
                team2SetWins++;
            }
        }

        if (team1SetWins >= setsToWinMatch) {
            return 'team1';
        } else if (team2SetWins >= setsToWinMatch) {
            return 'team2';
        }
        return null;
    }, [setsToWinMatch]);

    // --- Firebase Initialization and Authentication ---
    useEffect(() => {
        if (isFirebaseInitialized.current) {
            return;
        }

        try {
            firebaseAppInstance = initializeApp(firebaseConfigToUse);
            firestoreDbInstance = getFirestore(firebaseAppInstance);
            firebaseAuthInstance = getAuth(firebaseAppInstance);

            if (typeof window !== 'undefined' && firebaseConfigToUse.measurementId && firebaseConfigToUse.measurementId.trim() !== '') {
                try {
                    firebaseAnalyticsInstance = getAnalytics(firebaseAppInstance);
                    console.log("Firebase Analytics initialized.");
                } catch (analyticsError) {
                    console.warn("Firebase Analytics could not be initialized, continuing without it.", analyticsError);
                    firebaseAnalyticsInstance = null;
                }
            } else {
                console.warn("Firebase Analytics not initialized. `window` is not defined, `measurementId` is missing, or `measurementId` is empty.");
                firebaseAnalyticsInstance = null;
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
    }, [setMessageAndScroll]);


    // --- Fetch User Role from Firestore ---
    useEffect(() => {
        if (!db || !userId || !isAuthReady) {
            return;
        }

        const fetchUserRole = async () => {
            setIsLoadingRole(true);
            try {
                const userDocRef = doc(db, `artifacts/${resolvedAppId}/public/data/users`, userId);
                const userDocSnap = await getDoc(userDocRef);

                if (userDocSnap.exists()) {
                    const role = userDocSnap.data().role;
                    setUserRole(role || 'player'); // Default to 'player' if role field is missing
                    console.log(`User ${userId} role: ${role || 'player'}`);
                } else {
                    setUserRole('player'); // Default to 'player' if document doesn't exist
                    console.log(`User ${userId} has no explicit role, defaulting to 'player'.`);
                }
            } catch (error) {
                console.error("Error fetching user role:", error);
                setMessageAndScroll({ text: "Failed to fetch user role. Functionality might be limited.", type: "error" });
                setUserRole('player');
            } finally {
                setIsLoadingRole(false);
            }
        };

        fetchUserRole();
    }, [db, userId, isAuthReady, resolvedAppId, setMessageAndScroll]);


    // --- Fetch initial data (players, teams, matches, substitutes) from Firebase ---
    useEffect(() => {
        if (!db || !userId || !isAuthReady) {
            return;
        }

        const fetchAllData = async () => {
            setLoadingData(true);
            try {
                const playersColRef = collection(db, `artifacts/${resolvedAppId}/public/data/players`);
                const unsubscribePlayers = onSnapshot(playersColRef, (snapshot) => {
                    const fetchedPlayers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    setPlayers(fetchedPlayers);
                    const newPlayerInputs = Array(totalPlayersCount).fill({ name: '', handicap: '' });
                    fetchedPlayers.forEach((p, i) => {
                        if (i < totalPlayersCount) {
                            newPlayerInputs[i] = { name: p.name, handicap: p.handicap || '' };
                        }
                    });
                    setPlayerInputs(newPlayerInputs);
                }, (error) => console.error("Error fetching players:", error));

                const substitutesColRef = collection(db, `artifacts/${resolvedAppId}/public/data/substitutePlayers`);
                const unsubscribeSubstitutes = onSnapshot(substitutesColRef, (snapshot) => {
                    const fetchedSubstitutes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    setSubstitutePlayers(fetchedSubstitutes);
                }, (error) => console.error("Error fetching substitutes:", error));

                const teamsColRef = collection(db, `artifacts/${resolvedAppId}/public/data/teams`);
                const unsubscribeTeams = onSnapshot(teamsColRef, (snapshot) => {
                    const fetchedTeams = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    setTeams(fetchedTeams);
                }, (error) => console.error("Error fetching teams:", error));

                const matchesColRef = collection(db, `artifacts/${resolvedAppId}/public/data/matches`);
                const unsubscribeMatches = onSnapshot(matchesColRef, (snapshot) => {
                    let fetchedMatches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    fetchedMatches.sort((a, b) => {
                        const dateTimeA = new Date(`${a.date}T${a.time}`);
                        const dateTimeB = new Date(`${b.date}T${b.time}`);
                        return dateTimeA - dateTimeB;
                    });
                    setMatches(fetchedMatches);
                    setLoadingData(false);
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
    }, [db, userId, isAuthReady, totalPlayersCount, resolvedAppId, setMessageAndScroll]);

    // --- Filter matches whenever 'matches' or 'showMyMatchesOnly' or 'userId' changes ---
    useEffect(() => {
        if (showMyMatchesOnly && userId) {
            const myFiltered = matches.filter(match =>
                match.createdBy === userId ||
                (userRole === 'teamCaptain' && (
                    (teams.find(t => t.id === match.team1Id)?.player1Id === userId || teams.find(t => t.id === match.team1Id)?.player2Id === userId) ||
                    (teams.find(t => t.id === match.team2Id)?.player1Id === userId || teams.find(t => t.id === match.team2Id)?.player2Id === userId)
                ))
            );
            setFilteredMatches(myFiltered);
        } else {
            setFilteredMatches(matches);
        }
    }, [matches, showMyMatchesOnly, userId, userRole, teams]);


    // --- Handlers for Player Management ---
    const handlePlayerInputChange = (index, field, value) => {
        const newPlayerInputs = [...playerInputs];
        newPlayerInputs[index] = { ...newPlayerInputs[index], [field]: value };
        setPlayerInputs(newPlayerInputs);
    };

    const addPlayersToFirestore = async () => {
        setMessageAndScroll({ text: null, type: null });
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
            const playersColRef = collection(db, `artifacts/${resolvedAppId}/public/data/players`);
            const existingPlayersSnapshot = await getDocs(playersColRef);
            for (const docSnapshot of existingPlayersSnapshot.docs) {
                await deleteDoc(doc(db, `artifacts/${resolvedAppId}/public/data/players`, docSnapshot.id));
            }

            const newPlayerDocs = [];
            for (const player of validPlayers) {
                const docRef = await addDoc(playersColRef, {
                    name: player.name.trim(),
                    handicap: Number(player.handicap),
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
        setMessageAndScroll({ text: null, type: null });
        if (!db || !userId) {
            setMessageAndScroll({ text: "App not ready. Please wait or refresh.", type: "error" });
            return;
        }
        if (newSubstituteName.trim() === '' || newSubstituteHandicap === '' || isNaN(Number(newSubstituteHandicap))) {
            setMessageAndScroll({ text: "Please enter a valid name and numeric handicap for the substitute player.", type: "error" });
            return;
        }

        try {
            await addDoc(collection(db, `artifacts/${resolvedAppId}/public/data/substitutePlayers`), {
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
        setMessageAndScroll({ text: null, type: null });
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
            const teamsColRef = collection(db, `artifacts/${resolvedAppId}/public/data/teams`);
            const existingTeamsSnapshot = await getDocs(teamsColRef);
            for (const docSnapshot of existingTeamsSnapshot.docs) {
                await deleteDoc(doc(db, `artifacts/${resolvedAppId}/public/data/teams`, docSnapshot.id));
            }

            const sortedPlayers = [...players].sort((a, b) => a.handicap - b.handicap);

            const newTeams = [];
            for (let i = 0; i < numberOfTeams; i++) {
                const player1 = sortedPlayers[i];
                const player2 = sortedPlayers[sortedPlayers.length - 1 - i];

                const teamName = `Team ${String.fromCharCode(65 + i)}`;
                const teamHandicapSum = player1.handicap + player2.handicap;

                const docRef = await addDoc(teamsColRef, {
                    name: teamName,
                    player1Id: player1.id,
                    player2Id: player2.id,
                    player1Name: player1.name,
                    player2Name: player2.name,
                    player1Handicap: player1.handicap,
                    player2Handicap: player2.handicap,
                    teamHandicapSum: teamHandicapSum,
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
        setMessageAndScroll({ text: null, type: null });
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
            const matchesColRef = collection(db, `artifacts/${resolvedAppId}/public/data/matches`);
            const existingMatchesSnapshot = await getDocs(matchesColRef);
            for (const docSnapshot of existingMatchesSnapshot.docs) {
                await deleteDoc(doc(db, `artifacts/${resolvedAppId}/public/data/matches`, docSnapshot.id));
            }

            const courts = Array.from({ length: courtsPerDayCount }, (_, i) => `Court ${i + 1}`);
            const days = tournamentDurationDays;
            const timesPerDay = ['09:00', '10:30', '12:00', '13:30'];

            const allTeams = [...teams];
            let teamPairs = [];

            for (let i = 0; i < allTeams.length; i++) {
                for (let j = i + 1; j < allTeams.length; j++) {
                    teamPairs.push([allTeams[i], allTeams[j]]);
                }
            }
            teamPairs = teamPairs.sort(() => 0.5 - Math.random());

            let matchCounter = 0;
            let currentPairIndex = 0;
            const newMatches = [];

            for (let day = 0; day < days; day++) {
                const currentDate = new Date();
                currentDate.setDate(currentDate.getDate() + day);
                const formattedDate = currentDate.toISOString().split('T')[0];

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
                                createdAt: serverTimestamp(),
                                substituteInfo: null,
                                score: null,
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
                            break;
                        }
                    }
                    if (currentPairIndex >= teamPairs.length) break;
                }
                if (currentPairIndex >= teamPairs.length) break;
            }

            setMatches(newMatches);
            setMessageAndScroll({ text: `Generated ${matchCounter} matches across ${days} days using ${courts.length} courts!`, type: "success" });
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
        setMessageAndScroll({ text: null, type: null });
        if (!db || !matchToCancel) {
            setMessageAndScroll({ text: "Cannot cancel match. App not ready or no match selected.", type: "error" });
            setMatchToCancel(null);
            return;
        }

        try {
            await updateDoc(doc(db, `artifacts/${resolvedAppId}/public/data/matches`, matchToCancel.id), {
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
            setMatchToCancel(null);
            setShowClearDataConfirm(false);
        }
    };

    // --- Handle Substitution Logic ---
    const handleOpenSubstituteModal = (match) => {
        setSelectedMatchForSubstitution(match);
        setPlayerToSubstituteKey('');
        setSelectedSubstituteId('');
        setShowSubstituteModal(true);
    };

    const handleConfirmSubstitution = async () => {
        setMessageAndScroll({ text: null, type: null });
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
        let affectedTeamKey = '';

        if (playerToSubstituteKey === 'team1_player1') {
            originalPlayerName = match.team1OriginalPlayer1Name;
            originalPlayerHandicap = match.team1OriginalPlayer1Handicap;
            affectedTeamKey = 'team1';
            updatedMatchData.team1OriginalPlayer1Name = substitute.name;
            updatedMatchData.team1OriginalPlayer1Handicap = substitute.handicap;
        } else if (playerToSubstituteKey === 'team1_player2') {
            originalPlayerName = match.team1OriginalPlayer2Name;
            originalPlayerHandicap = match.team1OriginalPlayer2Handicap;
            affectedTeamKey = 'team1';
            updatedMatchData.team1OriginalPlayer2Name = substitute.name;
            updatedMatchData.team1OriginalPlayer2Handicap = substitute.handicap;
        } else if (playerToSubstituteKey === 'team2_player1') {
            originalPlayerName = match.team2OriginalPlayer1Name;
            originalPlayerHandicap = match.team2OriginalPlayer1Handicap;
            affectedTeamKey = 'team2';
            updatedMatchData.team2OriginalPlayer1Name = substitute.name;
            updatedMatchData.team2OriginalPlayer1Handicap = substitute.handicap;
        } else if (playerToSubstituteKey === 'team2_player2') {
            originalPlayerName = match.team2OriginalPlayer2Name;
            originalPlayerHandicap = match.team2OriginalPlayer2Handicap;
            affectedTeamKey = 'team2';
            updatedMatchData.team2OriginalPlayer2Name = substitute.name;
            updatedMatchData.team2OriginalPlayer2Handicap = substitute.handicap;
        }

        if (affectedTeamKey === 'team1') {
            updatedMatchData.team1HandicapSum = updatedMatchData.team1OriginalPlayer1Handicap + updatedMatchData.team1OriginalPlayer2Handicap;
        } else if (affectedTeamKey === 'team2') {
            updatedMatchData.team2HandicapSum = updatedMatchData.team2OriginalPlayer1Handicap + updatedMatchData.team2OriginalPlayer2Handicap;
        }

        updatedMatchData.substituteInfo = {
            affectedTeam: affectedTeamKey,
            originalPlayerName: originalPlayerName,
            substitutePlayerName: substitute.name,
            originalPlayerHandicap: originalPlayerHandicap,
            substitutePlayerHandicap: substitute.handicap,
            newTeamHandicapSum: updatedMatchData[`${affectedTeamKey}HandicapSum`],
            substitutedBy: userId,
            substitutedAt: serverTimestamp()
        };

        try {
            await updateDoc(doc(db, `artifacts/${resolvedAppId}/public/data/matches`, match.id), updatedMatchData);
            setMessageAndScroll({ text: `Substitution confirmed! ${originalPlayerName} replaced by ${substitute.name} in match on ${match.date}.`, type: "success" });
            logAnalyticsEvent('match_substitution', {
                match_id: match.id,
                original_player: originalPlayerName,
                substitute_player: substitute.name,
                user_id: userId
            });
        } catch (error) {
            console.error("Error confirming substitution:", error);
            setMessageAndScroll({ text: "Failed to confirm substitution. Please try again.", type: "error" });
        } finally {
            setShowSubstituteModal(false);
            setSelectedMatchForSubstitution(null);
            setPlayerToSubstituteKey('');
            setSelectedSubstituteId('');
        }
    };

    // --- Score Entry Logic ---
    const handleOpenScoreEntryModal = (match) => {
        setMessageAndScroll({ text: null, type: null });
        setMatchForScoreEntry(match);
        if (match.score) {
            setScoreInput({
                team1Sets: match.score.team1Sets || [],
                team2Sets: match.score.team2Sets || []
            });
        } else {
            setScoreInput({ team1Sets: [], team2Sets: [] });
        }
        setCurrentSetScores({ team1Games: '', team2Games: '' });
        setShowScoreEntryModal(true);
    };

    const handleCloseScoreEntryModal = () => {
        setShowScoreEntryModal(false);
        setMatchForScoreEntry(null);
        setScoreInput({ team1Sets: [], team2Sets: [] });
        setCurrentSetScores({ team1Games: '', team2Games: '' });
    };

    const handleSetScoreChange = (teamKey, value) => {
        setCurrentSetScores(prev => ({ ...prev, [teamKey]: value }));
    };

    const handleAddSetScore = () => {
        const t1Games = parseInt(currentSetScores.team1Games);
        const t2Games = parseInt(currentSetScores.team2Games);

        if (isNaN(t1Games) || isNaN(t2Games) || t1Games < 0 || t2Games < 0) {
            setMessageAndScroll({ text: "Please enter valid numeric game scores for the set.", type: "error" });
            return;
        }

        const isSetComplete = (score1, score2) => {
            if (score1 >= gamesToWinSet && score1 - score2 >= 2) return true;
            if (score2 >= gamesToWinSet && score2 - score1 >= 2) return true;
            if (score1 === tiebreakerScoreThreshold && score2 === tiebreakerScoreThreshold) return true;
            return false;
        };

        const isTiebreakerSet = (score1, score2) => {
             return (score1 === tiebreakerScoreThreshold && score2 === tiebreakerScoreThreshold);
        }

        if (!isSetComplete(t1Games, t2Games) && !isTiebreakerSet(t1Games,t2Games) && (t1Games !== tiebreakerScoreThreshold && t2Games !== tiebreakerScoreThreshold)) {
            setMessageAndScroll({ text: `A set must be won by at least 2 games and reach ${gamesToWinSet} games, or be at ${tiebreakerScoreThreshold}-${tiebreakerScoreThreshold} for a tiebreaker.`, type: "error" });
            return;
        }

        if (isTiebreakerSet(t1Games, t2Games)) {
             if (t1Games !== tiebreakerScoreThreshold || t2Games !== tiebreakerScoreThreshold) {
                 setMessageAndScroll({ text: `Invalid tiebreaker score. Both teams must be at ${tiebreakerScoreThreshold} games to enter a tiebreaker.`, type: "error" });
                 return;
             }
        }

        setScoreInput(prev => ({
            team1Sets: [...prev.team1Sets, t1Games],
            team2Sets: [...prev.team2Sets, t2Games]
        }));
        setCurrentSetScores({ team1Games: '', team2Games: '' });
        setMessageAndScroll({ text: null, type: null });
    };

    const handleRemoveLastSet = () => {
        setScoreInput(prev => ({
            team1Sets: prev.team1Sets.slice(0, -1),
            team2Sets: prev.team2Sets.slice(0, -1)
        }));
    };

    const handleSaveMatchScore = async () => {
        setMessageAndScroll({ text: null, type: null });
        if (!db || !matchForScoreEntry) {
            setMessageAndScroll({ text: "App not ready or no match selected.", type: "error" });
            return;
        }
        if (!userId) { // Ensure userId is available for 'scoredBy'
            setMessageAndScroll({ text: "User not authenticated. Cannot save score.", type: "error" });
            return;
        }

        if (scoreInput.team1Sets.length === 0 || scoreInput.team2Sets.length === 0) {
            setMessageAndScroll({ text: "Please enter at least one set score.", type: "error" });
            return;
        }

        if (scoreInput.team1Sets.length !== scoreInput.team2Sets.length) {
            setMessageAndScroll({ text: "Mismatch in number of sets entered for each team.", type: "error" });
            return;
        }

        const winnerKey = calculateMatchWinner(scoreInput.team1Sets, scoreInput.team2Sets);
        if (!winnerKey) {
            setMessageAndScroll({ text: `Match not yet concluded. A team needs to win ${setsToWinMatch} sets.`, type: "error" });
            return;
        }

        const winnerTeamId = winnerKey === 'team1' ? matchForScoreEntry.team1Id : matchForScoreEntry.team2Id;
        const loserTeamId = winnerKey === 'team1' ? matchForScoreEntry.team2Id : matchForScoreEntry.team1Id;
        const status = 'completed';

        // Client-side check for Team Captain - the Firestore rules are the ultimate gate.
        const isTeamCaptainForMatch = userRole === 'teamCaptain' && (
            (teams.find(t => t.id === matchForScoreEntry.team1Id)?.player1Id === userId || teams.find(t => t.id === matchForScoreEntry.team1Id)?.player2Id === userId) ||
            (teams.find(t => t.id === matchForScoreEntry.team2Id)?.player1Id === userId || teams.find(t => t.id === matchForScoreEntry.team2Id)?.player2Id === userId)
        );

        if (userRole !== 'admin' && userRole !== 'tournamentManager' && !isTeamCaptainForMatch) {
            setMessageAndScroll({ text: "You do not have permission to enter scores for this match.", type: "error" });
            return;
        }

        try {
            await updateDoc(doc(db, `artifacts/${resolvedAppId}/public/data/matches`, matchForScoreEntry.id), {
                score: {
                    team1Sets: scoreInput.team1Sets,
                    team2Sets: scoreInput.team2Sets,
                    winnerTeamId: winnerTeamId,
                    loserTeamId: loserTeamId,
                    finalScoreString: scoreInput.team1Sets.map((s, i) => `${s}-${scoreInput.team2Sets[i]}`).join(', ')
                },
                winnerTeamId: winnerTeamId,
                loserTeamId: loserTeamId,
                status: status,
                scoredBy: userId, // Ensure userId is passed for security rule validation
                scoredAt: serverTimestamp()
            });
            setMessageAndScroll({ text: `Score entered successfully for match on ${matchForScoreEntry.date}.`, type: "success" });
            logAnalyticsEvent('enter_match_score', {
                match_id: matchForScoreEntry.id,
                winner_team_id: winnerTeamId,
                score: scoreInput.team1Sets.map((s, i) => `${s}-${scoreInput.team2Sets[i]}`).join(', '),
                user_id: userId
            });
            handleCloseScoreEntryModal();
        } catch (error) {
            console.error("Error saving match score:", error);
            setMessageAndScroll({ text: "Failed to save match score. Please try again. Ensure you have the correct permissions.", type: "error" });
        }
    };

    // --- AI Match Analysis ---
    const generateMatchAnalysis = async (match) => {
        setMessageAndScroll({ text: null, type: null });
        setAiAnalysisResult(null);
        setIsGeneratingAnalysis(true);
        setShowAiAnalysisModal(true);

        if (!geminiApiKey || geminiApiKey.trim() === 'YOUR_DEFAULT_GEMINI_API_KEY_HERE') {
            setMessageAndScroll({ text: "Gemini API Key is not configured. AI analysis is unavailable.", type: "error" });
            setIsGeneratingAnalysis(false);
            return;
        }

        if (!match || !match.score) {
            setMessageAndScroll({ text: "Cannot generate analysis for an incomplete or unscheduled match.", type: "error" });
            setIsGeneratingAnalysis(false);
            return;
        }

        const team1Name = escapeMarkdown(match.team1Name);
        const team2Name = escapeMarkdown(match.team2Name);
        const team1Player1Name = escapeMarkdown(match.team1OriginalPlayer1Name);
        const team1Player2Name = escapeMarkdown(match.team1OriginalPlayer2Name);
        const team2Player1Name = escapeMarkdown(match.team2OriginalPlayer1Name);
        const team2Player2Name = escapeMarkdown(match.team2OriginalPlayer2Name);
        const team1HandicapSum = match.team1HandicapSum;
        const team2HandicapSum = match.team2HandicapSum;
        const scoreString = match.score.finalScoreString;
        const winnerTeamName = match.score.winnerTeamId === match.team1Id ? team1Name : team2Name;
        const loserTeamName = match.score.winnerTeamId === match.team1Id ? team2Name : team1Name;

        const prompt = `Analyze the following tennis match and provide insightful commentary.

        Match Details:
        Team 1: ${team1Name} (Players: ${team1Player1Name} and ${team1Player2Name}, Combined Handicap: ${team1HandicapSum})
        Team 2: ${team2Name} (Players: ${team2Player1Name} and ${team2Player2Name}, Combined Handicap: ${team2HandicapSum})
        Final Score: ${scoreString} (Winner: ${winnerTeamName}, Loser: ${loserTeamName})

        Consider the following for your analysis:
        1.  **Handicap Expectation**: Given their handicaps, which team was theoretically expected to perform better or worse? A lower handicap sum indicates a stronger team.
            * Team 1's combined handicap: ${team1HandicapSum}
            * Team 2's combined handicap: ${team2HandicapSum}
            * If ${team1HandicapSum} > ${team2HandicapSum}, Team 1 was theoretically weaker.
            * If ${team2HandicapSum} > ${team1HandicapSum}, Team 2 was theoretically weaker.
        2.  **Actual Outcome vs. Expectation**: Did the match outcome align with the handicap expectations? Were there any upsets?
        3.  **Performance Highlights**: Based on the score, what can be inferred about key moments? Were there dominant sets, close sets, or comebacks?
        4.  **Overall Match Summary**: Provide a concise summary of the match, highlighting its most notable aspects.

        Structure your analysis clearly with headings for each point. Be concise and professional.
        `;

        try {
            const genAI = new GoogleGenerativeAI(geminiApiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-pro" });

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            setAiAnalysisResult(text);
            logAnalyticsEvent('generate_ai_analysis', {
                match_id: match.id,
                user_id: userId,
                model_used: "gemini-pro"
            });
        } catch (error) {
            console.error("Error generating AI analysis:", error);
            setAiAnalysisResult("Failed to generate analysis. Please try again later. Error: " + error.message);
            setMessageAndScroll({ text: "Failed to generate AI analysis. See console for details.", type: "error" });
        } finally {
            setIsGeneratingAnalysis(false);
        }
    };

    const handleCloseAiAnalysisModal = () => {
        setShowAiAnalysisModal(false);
        setAiAnalysisResult(null);
    };

    // --- AI-Assisted Optimal Match Pairings ---
    const generateOptimalPairings = async () => {
        setMessageAndScroll({ text: null, type: null });
        setOptimalPairingsResult(null);
        setGettingOptimalPairings(true);
        setShowOptimalPairingsModal(true);

        if (!geminiApiKey || geminiApiKey.trim() === 'YOUR_DEFAULT_GEMINI_API_KEY_HERE') {
            setMessageAndScroll({ text: "Gemini API Key is not configured. AI pairings are unavailable.", type: "error" });
            setGettingOptimalPairings(false);
            return;
        }

        if (teams.length < 2) {
            setMessageAndScroll({ text: "Need at least 2 teams to generate optimal pairings. Please generate teams first.", type: "error" });
            setGettingOptimalPairings(false);
            return;
        }

        const teamDataForAI = teams.map(team => ({
            name: escapeMarkdown(team.name),
            player1: escapeMarkdown(team.player1Name),
            player2: escapeMarkdown(team.player2Name),
            handicapSum: team.teamHandicapSum
        }));

        const prompt = `You are an expert tennis tournament scheduler. Given the following teams and their combined handicaps, suggest the most optimal pairings for a round of doubles matches. The goal is to create competitive and balanced matches where possible, but also to ensure variety.

        Teams:
        ${teamDataForAI.map(t => `- ${t.name} (Players: ${t.player1}, ${t.player2}, Combined Handicap: ${t.handicapSum})`).join('\n')}

        Guidelines for Optimal Pairings:
        1.  **Balance**: Try to pair teams with similar combined handicaps for competitive matches.
        2.  **Variety**: Avoid pairing the same teams against each other in consecutive suggestions (though for a single "round" this might not apply as much). Try to mix up who plays whom.
        3.  **Format**: Suggest as many unique matches as possible for one round. Each team should ideally play once in this round.
        4.  **Output**: List the pairings clearly, indicating the teams involved and their combined handicaps. For each suggested match, provide a brief rationale based on handicaps (e.g., "Well-matched based on similar handicaps" or "Strong team vs. weaker team for a challenging match").
        5.  **Structure**: Provide the pairings in a clear, readable list format.

        Example Output Structure:
        ### Optimal Match Pairings - Round 1

        1.  **Match 1:** Team A (Handicap X) vs Team B (Handicap Y)
            * Rationale: [Brief explanation]
        2.  **Match 2:** Team C (Handicap Z) vs Team D (Handicap W)
            * Rationale: [Brief explanation]
        ... and so on.
        `;

        try {
            const genAI = new GoogleGenerativeAI(geminiApiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-pro" });

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            setOptimalPairingsResult(text);
            logAnalyticsEvent('generate_optimal_pairings', {
                num_teams: teams.length,
                user_id: userId,
                model_used: "gemini-pro"
            });
        } catch (error) {
            console.error("Error generating optimal pairings:", error);
            setOptimalPairingsResult("Failed to generate optimal pairings. Please try again later. Error: " + error.message);
            setMessageAndScroll({ text: "Failed to generate optimal pairings. See console for details.", type: "error" });
        } finally {
            setGettingOptimalPairings(false);
        }
    };

    const handleCloseOptimalPairingsModal = () => {
        setShowOptimalPairingsModal(false);
        setOptimalPairingsResult(null);
    };

    // --- Main Clear All Data Function ---
    const handleClearAllData = async () => {
        setMessageAndScroll({ text: null, type: null });
        if (!db || !userId) {
            setMessageAndScroll({ text: "App not ready. Please wait or refresh.", type: "error" });
            return;
        }

        try {
            const collectionsToClear = ['players', 'teams', 'matches', 'substitutePlayers'];
            for (const collectionName of collectionsToClear) {
                const colRef = collection(db, `artifacts/${resolvedAppId}/public/data/${collectionName}`);
                const snapshot = await getDocs(colRef);
                for (const docSnapshot of snapshot.docs) {
                    await deleteDoc(doc(db, `artifacts/${resolvedAppId}/public/data/${collectionName}`, docSnapshot.id));
                }
            }
            setMessageAndScroll({ text: "All tournament data cleared successfully!", type: "success" });
            logAnalyticsEvent('clear_all_data', { user_id: userId });
        } catch (error) {
            console.error("Error clearing all data:", error);
            setMessageAndScroll({ text: "Failed to clear all data. Please try again.", type: "error" });
        } finally {
            setShowClearDataConfirm(false);
        }
    };

    // --- Calculate Tournament Standings ---
    const calculateTeamStandings = useCallback(() => {
        const standingsMap = new Map();

        teams.forEach(team => {
            standingsMap.set(team.id, {
                id: team.id,
                name: team.name,
                player1Name: team.player1Name,
                player2Name: team.player2Name,
                handicapSum: team.teamHandicapSum,
                matchesPlayed: 0,
                wins: 0,
                losses: 0,
                setsWon: 0,
                setsLost: 0,
                gamesWon: 0,
                gamesLost: 0,
                points: 0
            });
        });

        matches.filter(m => m.status === 'completed' && m.score).forEach(match => {
            const team1Stats = standingsMap.get(match.team1Id);
            const team2Stats = standingsMap.get(match.team2Id);

            if (!team1Stats || !team2Stats) {
                console.warn(`Skipping match ${match.id} due to missing team data.`);
                return;
            }

            team1Stats.matchesPlayed++;
            team2Stats.matchesPlayed++;

            if (match.score.team1Sets && match.score.team2Sets) {
                match.score.team1Sets.forEach((t1Games, index) => {
                    const t2Games = match.score.team2Sets[index];
                    team1Stats.gamesWon += t1Games;
                    team1Stats.gamesLost += t2Games;
                    team2Stats.gamesWon += t2Games;
                    team2Stats.gamesLost += t1Games;

                    if (t1Games > t2Games) {
                        team1Stats.setsWon++;
                        team2Stats.setsLost++;
                    } else if (t2Games > t1Games) {
                        team2Stats.setsWon++;
                        team1Stats.setsLost++;
                    }
                });
            }

            if (match.winnerTeamId === match.team1Id) {
                team1Stats.wins++;
                team2Stats.losses++;
                team1Stats.points += 3;
            } else if (match.winnerTeamId === match.team2Id) {
                team2Stats.wins++;
                team1Stats.losses++;
                team2Stats.points += 3;
            }
        });

        const sortedStandings = Array.from(standingsMap.values()).sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins;
            const aSetDiff = a.setsWon - a.setsLost;
            const bSetDiff = b.setsWon - b.setsLost;
            if (bSetDiff !== aSetDiff) return bSetDiff - aSetDiff;
            const aGameDiff = a.gamesWon - a.gamesLost;
            const bGameDiff = b.gamesWon - b.gamesLost;
            if (bGameDiff !== aGameDiff) return bGameDiff - aGameDiff;
            return a.name.localeCompare(b.name);
        });

        setTeamStandings(sortedStandings);
    }, [teams, matches, setsToWinMatch]);

    useEffect(() => {
        calculateTeamStandings();
    }, [calculateTeamStandings]);

    return (
        <div className="min-h-screen bg-gray-100 p-4 sm:p-8 font-inter antialiased">
            <style>{`
                .font-inter {
                    font-family: 'Inter', sans-serif;
                }
                .input-field {
                    @apply p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent;
                }
                .btn-primary {
                    @apply bg-blue-500 text-white px-4 py-2 rounded-lg shadow hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition duration-200;
                }
                .btn-secondary {
                    @apply bg-gray-300 text-gray-800 px-4 py-2 rounded-lg shadow hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-opacity-50 transition duration-200;
                }
                .modal-overlay {
                    @apply fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4;
                }
                .modal-content {
                    @apply bg-white p-6 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto;
                }
                /* Additional styles for responsiveness */
                @media (max-width: 640px) {
                    .flex-col-mobile {
                        flex-direction: column;
                    }
                    .space-x-2 > *:not(:first-child) {
                        margin-left: 0;
                        margin-top: 0.5rem;
                    }
                    .sm\:w-auto {
                        width: 100%;
                    }
                }
            `}</style>

            <div className="max-w-4xl mx-auto">
                <h1 className="text-4xl font-extrabold text-center text-gray-900 mb-8">Steinman Tennis Tournament Manager</h1>

                {/* Message Display */}
                {message.text && (
                    <div className={`p-4 rounded-lg mb-6 shadow-md
                        ${message.type === 'success' ? 'bg-green-100 text-green-800 border border-green-300' :
                        message.type === 'error' ? 'bg-red-100 text-red-800 border border-red-300' :
                        message.type === 'info' ? 'bg-blue-100 text-blue-800 border border-blue-300' :
                        'bg-gray-100 text-gray-800 border border-gray-300'}`}
                    >
                        <p className="font-medium">{message.text}</p>
                    </div>
                )}

                {/* Current User Role Display */}
                <div className="text-right text-gray-600 mb-4">
                    {isLoadingRole ? <p>Loading user role...</p> : <p>Your Role: <span className="font-semibold text-blue-700">{userRole.toUpperCase()}</span></p>}
                    {userId && <p className="text-xs">Your User ID: {userId}</p>}
                </div>

                {/* Tournament Configuration Section (Admin & Tournament Manager only) */}
                {(userRole === 'admin' || userRole === 'tournamentManager') && (
                    <section className="bg-white p-6 rounded-lg shadow mb-6">
                        <h2 className="text-2xl font-bold mb-4 text-gray-800">Tournament Configuration</h2>
                        {isLoadingRole ? (
                            <p className="text-center text-gray-600">Loading user role and permissions...</p>
                        ) : (
                            <>
                                {/* 1. Players & Handicaps */}
                                <h3 className="text-xl font-semibold mb-3 text-gray-700">1. Players & Handicaps ({totalPlayersCount} Players)</h3>
                                <p className="text-sm text-gray-600 mb-4">Enter names and handicaps (e.g., 1-10, lower is better). The system will use these to balance teams.</p>
                                <div className="mb-4">
                                    <label htmlFor="totalPlayers" className="block text-sm font-medium text-gray-700 mb-1">Total Number of Players (Even number, min 2):</label>
                                    <input
                                        type="number"
                                        id="totalPlayers"
                                        value={totalPlayersCount}
                                        onChange={(e) => {
                                            const count = parseInt(e.target.value);
                                            if (!isNaN(count) && count >= 2 && count % 2 === 0) {
                                                setTotalPlayersCount(count);
                                                setPlayerInputs(Array(count).fill({ name: '', handicap: '' }).map((_, i) => playerInputs[i] || { name: '', handicap: '' }));
                                            } else if (e.target.value === '') {
                                                setTotalPlayersCount('');
                                            } else if (isNaN(count) || count < 2) {
                                                setMessageAndScroll({ text: "Total players must be a number greater than or equal to 2.", type: "error" });
                                            } else if (count % 2 !== 0) {
                                                setMessageAndScroll({ text: "Total players must be an even number.", type: "error" });
                                            }
                                        }}
                                        min="2"
                                        step="2"
                                        className="input-field w-full sm:w-auto"
                                        placeholder="e.g., 20"
                                    />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                    {playerInputs.slice(0, totalPlayersCount === '' ? 0 : totalPlayersCount).map((player, index) => (
                                        <div key={index} className="flex items-center space-x-2">
                                            <span className="font-medium text-gray-700 w-8">P{index + 1}:</span>
                                            <input
                                                type="text"
                                                placeholder="Player Name"
                                                value={player.name}
                                                onChange={(e) => handlePlayerInputChange(index, 'name', e.target.value)}
                                                className="input-field flex-grow"
                                            />
                                            <input
                                                type="number"
                                                placeholder="Handicap"
                                                value={player.handicap}
                                                onChange={(e) => handlePlayerInputChange(index, 'handicap', e.target.value)}
                                                className="input-field w-24"
                                            />
                                        </div>
                                    ))}
                                </div>
                                <button
                                    onClick={addPlayersToFirestore}
                                    className="btn-primary mb-6"
                                    disabled={playerInputs.some(p => p.name.trim() === '' || p.handicap === '' || isNaN(Number(p.handicap))) || playerInputs.length !== totalPlayersCount}
                                >
                                    Add/Update {totalPlayersCount} Players
                                </button>

                                {/* 2. Generate Teams */}
                                <h3 className="text-xl font-semibold mb-3 text-gray-700">2. Generate Teams</h3>
                                <p className="text-sm text-gray-600 mb-4">Creates balanced doubles teams based on handicaps.</p>
                                <button
                                    onClick={generateTeams}
                                    className="btn-primary mb-6"
                                    disabled={players.length === 0 || !isTotalPlayersEven || players.length !== totalPlayersCount || teams.length === numberOfTeams}
                                >
                                    Generate Teams ({numberOfTeams} Doubles Teams)
                                </button>

                                {/* 3. Schedule Configuration */}
                                <h3 className="text-xl font-semibold mb-3 text-gray-700">3. Schedule Configuration</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                    <div>
                                        <label htmlFor="courtsPerDay" className="block text-sm font-medium text-gray-700 mb-1">Courts per Day:</label>
                                        <input
                                            type="number"
                                            id="courtsPerDay"
                                            value={courtsPerDayCount}
                                            onChange={(e) => setCourtsPerDayCount(Math.max(1, parseInt(e.target.value) || 1))}
                                            min="1"
                                            className="input-field w-full"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="tournamentDuration" className="block text-sm font-medium text-gray-700 mb-1">Tournament Duration (Days):</label>
                                        <input
                                            type="number"
                                            id="tournamentDuration"
                                            value={tournamentDurationDays}
                                            onChange={(e) => setTournamentDurationDays(Math.max(1, parseInt(e.target.value) || 1))}
                                            min="1"
                                            className="input-field w-full"
                                        />
                                    </div>
                                </div>
                                <button
                                    onClick={generateSchedule}
                                    className="btn-primary mb-6"
                                    disabled={teams.length === 0 || matches.length > 0}
                                >
                                    Generate Match Schedule
                                </button>

                                {/* 4. AI-Assisted Optimal Match Pairings */}
                                <h3 className="text-xl font-semibold mb-3 mt-6 text-gray-700">4. AI-Assisted Optimal Match Pairings</h3>
                                <p className="text-sm text-gray-600 mb-4">Get AI suggestions for balanced and varied match pairings for a round, based on current teams.</p>
                                <button
                                    onClick={generateOptimalPairings}
                                    className="bg-blue-600 text-white px-4 py-2 rounded-lg shadow hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition duration-200"
                                    disabled={teams.length === 0 || gettingOptimalPairings}
                                >
                                    {gettingOptimalPairings ? 'Generating Optimal Pairings...' : 'AI Suggest Optimal Pairings'}
                                </button>

                                {/* Danger Zone: Clear All Tournament Data (Admin only) */}
                                {userRole === 'admin' && (
                                    <>
                                        <h3 className="text-xl font-semibold mb-3 mt-6 text-gray-700">Danger Zone: Clear All Tournament Data</h3>
                                        <p className="text-sm text-gray-600 mb-4">This action will permanently delete ALL players, teams, substitutes, and matches. Use with caution.</p>
                                        <button
                                            onClick={() => setShowClearDataConfirm(true)}
                                            className="bg-red-600 text-white px-4 py-2 rounded-lg shadow hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-50 transition duration-200"
                                        >
                                            Clear All Data
                                        </button>
                                    </>
                                )}
                            </>
                        )}
                    </section>
                )}

                {/* Substitute Players Section (Admin & Tournament Manager only) */}
                {(userRole === 'admin' || userRole === 'tournamentManager') && (
                    <section className="bg-white p-6 rounded-lg shadow mb-6">
                        <h2 className="text-2xl font-bold mb-4 text-gray-800">Substitute Players</h2>
                        {isLoadingRole ? (
                            <p className="text-center text-gray-600">Loading user role and permissions...</p>
                        ) : (
                            <>
                                <div className="mb-4">
                                    <label htmlFor="newSubstituteName" className="block text-sm font-medium text-gray-700 mb-1">Add New Substitute Player:</label>
                                    <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
                                        <input
                                            type="text"
                                            id="newSubstituteName"
                                            placeholder="Substitute Name"
                                            value={newSubstituteName}
                                            onChange={(e) => setNewSubstituteName(e.target.value)}
                                            className="input-field flex-grow"
                                        />
                                        <input
                                            type="number"
                                            placeholder="Handicap"
                                            value={newSubstituteHandicap}
                                            onChange={(e) => setNewSubstituteHandicap(e.target.value)}
                                            className="input-field w-full sm:w-24"
                                        />
                                        <button onClick={handleAddSubstitutePlayer} className="btn-primary w-full sm:w-auto">
                                            Add Substitute
                                        </button>
                                    </div>
                                </div>
                                <h3 className="text-lg font-semibold mb-2 text-gray-700">Current Substitute Players:</h3>
                                {substitutePlayers.length > 0 ? (
                                    <ul className="list-disc ml-5">
                                        {substitutePlayers.map(sub => (
                                            <li key={sub.id}>{sub.name} (Handicap: {sub.handicap})</li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-gray-600">No substitute players added yet.</p>
                                )}
                            </>
                        )}
                    </section>
                )}

                {/* Tournament Standings Section */}
                <section className="bg-white p-6 rounded-lg shadow mb-6">
                    <h2 className="text-2xl font-bold mb-4 text-gray-800">Tournament Standings</h2>
                    {teamStandings.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="min-w-full bg-white border border-gray-200 rounded-lg">
                                <thead>
                                    <tr className="bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                        <th className="py-3 px-4 border-b">Rank</th>
                                        <th className="py-3 px-4 border-b">Team</th>
                                        <th className="py-3 px-4 border-b">Players</th>
                                        <th className="py-3 px-4 border-b">Handicap</th>
                                        <th className="py-3 px-4 border-b">MP</th>
                                        <th className="py-3 px-4 border-b">W</th>
                                        <th className="py-3 px-4 border-b">L</th>
                                        <th className="py-3 px-4 border-b">SW</th>
                                        <th className="py-3 px-4 border-b">SL</th>
                                        <th className="py-3 px-4 border-b">GW</th>
                                        <th className="py-3 px-4 border-b">GL</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {teamStandings.map((team, index) => (
                                        <tr key={team.id} className="border-b border-gray-200 hover:bg-gray-50">
                                            <td className="py-3 px-4 text-sm text-gray-800">{index + 1}</td>
                                            <td className="py-3 px-4 text-sm text-gray-800 font-medium">{team.name}</td>
                                            <td className="py-3 px-4 text-sm text-gray-600">{team.player1Name}, {team.player2Name}</td>
                                            <td className="py-3 px-4 text-sm text-gray-600">{team.handicapSum}</td>
                                            <td className="py-3 px-4 text-sm text-gray-800">{team.matchesPlayed}</td>
                                            <td className="py-3 px-4 text-sm text-gray-800">{team.wins}</td>
                                            <td className="py-3 px-4 text-sm text-gray-800">{team.losses}</td>
                                            <td className="py-3 px-4 text-sm text-gray-800">{team.setsWon}</td>
                                            <td className="py-3 px-4 text-sm text-gray-800">{team.setsLost}</td>
                                            <td className="py-3 px-4 text-sm text-gray-800">{team.gamesWon}</td>
                                            <td className="py-3 px-4 text-sm text-gray-800">{team.gamesLost}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="text-gray-600">No team standings available. Generate teams and complete some matches to see the leaderboard.</p>
                    )}
                </section>

                {/* Match Schedule Display */}
                <section className="bg-white p-6 rounded-lg shadow mb-6">
                    <h2 className="text-2xl font-bold mb-4 text-gray-800">Match Schedule</h2>
                    <div className="mb-4">
                        <label className="inline-flex items-center">
                            <input
                                type="checkbox"
                                className="form-checkbox h-5 w-5 text-blue-600"
                                checked={showMyMatchesOnly}
                                onChange={() => setShowMyMatchesOnly(!showMyMatchesOnly)}
                            />
                            <span className="ml-2 text-gray-700">Show My Matches Only (Created by you or relevant to your team as Captain)</span>
                        </label>
                    </div>

                    {loadingData ? (
                        <p className="text-center text-gray-600">Loading matches...</p>
                    ) : filteredMatches.length > 0 ? (
                        <div className="grid grid-cols-1 gap-4">
                            {filteredMatches.map((match) => (
                                <div key={match.id} className="bg-gray-50 p-4 rounded-lg shadow">
                                    <p className="font-semibold text-lg text-gray-800">{match.team1Name} vs {match.team2Name}</p>
                                    <p className="text-gray-700">Date: {match.date} | Time: {match.time} | Court: {match.court}</p>
                                    <p className="text-sm text-gray-600">
                                        ({match.team1OriginalPlayer1Name}, {match.team1OriginalPlayer2Name} vs {match.team2OriginalPlayer1Name}, {match.team2OriginalPlayer2Name})
                                    </p>
                                    {match.substituteInfo && (
                                        <p className="text-sm text-yellow-700">
                                            <span className="font-semibold">SUB:</span> {match.substituteInfo.originalPlayerName} replaced by {match.substituteInfo.substitutePlayerName} in {match.substituteInfo.affectedTeam}
                                        </p>
                                    )}
                                    <p><strong>Status:</strong> <span className={`font-semibold ${match.status === 'cancelled' ? 'text-red-500' : match.status === 'completed' ? 'text-green-600' : 'text-blue-500'}`}>{match.status.toUpperCase()}</span></p>

                                    {match.score && (
                                        <div className="mt-2 text-sm">
                                            <strong>Final Score:</strong> {match.score.finalScoreString}
                                            <p>Winner: <span className="font-semibold">{match.winnerTeamId === match.team1Id ? match.team1Name : match.team2Name}</span></p>
                                        </div>
                                    )}

                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {/* Admin/Tournament Manager only match modification actions */}
                                        {(userRole === 'admin' || userRole === 'tournamentManager') && match.status === 'scheduled' && (
                                            <>
                                                <button
                                                    onClick={() => { setShowClearDataConfirm(true); setMatchToCancel(match); }}
                                                    className="bg-yellow-500 text-white px-3 py-1 rounded hover:bg-yellow-600 text-sm"
                                                >
                                                    Cancel Match
                                                </button>
                                                <button
                                                    onClick={() => handleOpenSubstituteModal(match)}
                                                    className="btn-secondary text-sm"
                                                >
                                                    Substitute Player
                                                </button>
                                            </>
                                        )}

                                        {/* Score Entry/Edit: Admin, Tournament Manager, Team Captain if their team is in the match and it's scheduled. */}
                                        {(userRole === 'admin' || userRole === 'tournamentManager' || (
                                            userRole === 'teamCaptain' && (
                                                (teams.find(t => t.id === match.team1Id)?.player1Id === userId || teams.find(t => t.id === match.team1Id)?.player2Id === userId) ||
                                                (teams.find(t => t.id === match.team2Id)?.player1Id === userId || teams.find(t => t.id === match.team2Id)?.player2Id === userId)
                                            )
                                        )) && match.status === 'scheduled' && (
                                            <button
                                                onClick={() => handleOpenScoreEntryModal(match)}
                                                className="btn-primary text-sm"
                                            >
                                                Enter Score
                                            </button>
                                        )}
                                        {/* View/Edit Score: For completed matches, same roles as above */}
                                        {(userRole === 'admin' || userRole === 'tournamentManager' || (
                                            userRole === 'teamCaptain' && (
                                                (teams.find(t => t.id === match.team1Id)?.player1Id === userId || teams.find(t => t.id === match.team1Id)?.player2Id === userId) ||
                                                (teams.find(t => t.id === match.team2Id)?.player1Id === userId || teams.find(t => t.id === match.team2Id)?.player2Id === userId)
                                            )
                                        )) && match.status === 'completed' && (
                                             <button
                                                onClick={() => handleOpenScoreEntryModal(match)}
                                                className="btn-secondary text-sm"
                                            >
                                                View/Edit Score
                                            </button>
                                        )}

                                        {/* AI Analyze Match: Available to all roles for completed matches */}
                                        {match.status === 'completed' && (userRole === 'admin' || userRole === 'tournamentManager' || userRole === 'teamCaptain' || userRole === 'player') && (
                                            <button
                                                onClick={() => generateMatchAnalysis(match)}
                                                className="bg-purple-600 text-white px-3 py-1 rounded hover:bg-purple-700 text-sm"
                                                disabled={isGeneratingAnalysis}
                                            >
                                                {isGeneratingAnalysis ? 'Analyzing...' : 'AI Analyze Match'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-gray-600">No matches scheduled yet. Generate players, teams, and a schedule to see matches here.</p>
                    )}
                </section>

                {/* Confirmation Modals */}
                {/* Clear All Data Confirmation Modal (Admin-only for the "clear all" action) */}
                {showClearDataConfirm && (
                    <div className="modal-overlay">
                        <div className="modal-content">
                            <h3>{matchToCancel ? "Confirm Match Cancellation" : "Confirm Clear All Data"}</h3>
                            <p className="mt-2 mb-4">
                                {matchToCancel
                                    ? `Are you sure you want to cancel the match on ${matchToCancel.date} at ${matchToCancel.time} on ${matchToCancel.court} between ${matchToCancel.team1Name} and ${matchToCancel.team2Name}? This action cannot be undone.`
                                    : "Are you sure you want to delete ALL tournament data (players, teams, substitutes, and matches)? This action cannot be undone and is permanent."}
                            </p>
                            <div className="modal-actions flex justify-end space-x-2">
                                <button
                                    onClick={() => {
                                        if (matchToCancel) {
                                            handleCancelMatch();
                                        } else {
                                            // Only allow clear all data if current user is admin
                                            if (userRole === 'admin') {
                                                handleClearAllData();
                                            } else {
                                                setMessageAndScroll({ text: "You do not have permission to clear all data.", type: "error" });
                                                setShowClearDataConfirm(false);
                                            }
                                        }
                                    }}
                                    className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600"
                                >
                                    {matchToCancel ? "Yes, Cancel Match" : "Yes, Clear All Data"}
                                </button>
                                <button
                                    onClick={() => { setShowClearDataConfirm(false); setMatchToCancel(null); }}
                                    className="btn-secondary"
                                >
                                    No, Keep Data
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Substitute Player Modal */}
                {showSubstituteModal && selectedMatchForSubstitution && (userRole === 'admin' || userRole === 'tournamentManager') && (
                    <div className="modal-overlay">
                        <div className="modal-content">
                            <h3>Substitute Player for Match</h3>
                            <p>Match: {selectedMatchForSubstitution.team1Name} vs {selectedMatchForSubstitution.team2Name}</p>
                            <p className="text-sm text-gray-600 mb-4">
                                Players: ({selectedMatchForSubstitution.team1OriginalPlayer1Name}, {selectedMatchForSubstitution.team1OriginalPlayer2Name}) vs ({selectedMatchForSubstitution.team2OriginalPlayer1Name}, {selectedMatchForSubstitution.team2OriginalPlayer2Name})
                            </p>

                            <div className="mb-4">
                                <label htmlFor="playerToSubstitute" className="block text-sm font-medium text-gray-700 mb-1">Select Player to Substitute:</label>
                                <select
                                    id="playerToSubstitute"
                                    value={playerToSubstituteKey}
                                    onChange={(e) => setPlayerToSubstituteKey(e.target.value)}
                                    className="input-field w-full"
                                >
                                    <option value="">-- Select Player --</option>
                                    <option value="team1_player1">{selectedMatchForSubstitution.team1Name}: {selectedMatchForSubstitution.team1OriginalPlayer1Name}</option>
                                    <option value="team1_player2">{selectedMatchForSubstitution.team1Name}: {selectedMatchForSubstitution.team1OriginalPlayer2Name}</option>
                                    <option value="team2_player1">{selectedMatchForSubstitution.team2Name}: {selectedMatchForSubstitution.team2OriginalPlayer1Name}</option>
                                    <option value="team2_player2">{selectedMatchForSubstitution.team2Name}: {selectedMatchForSubstitution.team2OriginalPlayer2Name}</option>
                                </select>
                            </div>

                            <div className="mb-4">
                                <label htmlFor="substitutePlayer" className="block text-sm font-medium text-gray-700 mb-1">Select Substitute Player:</label>
                                <select
                                    id="substitutePlayer"
                                    value={selectedSubstituteId}
                                    onChange={(e) => setSelectedSubstituteId(e.target.value)}
                                    className="input-field w-full"
                                    disabled={substitutePlayers.length === 0}
                                >
                                    <option value="">-- Select Substitute --</option>
                                    {substitutePlayers.map(sub => (
                                        <option key={sub.id} value={sub.id}>{sub.name} (Handicap: {sub.handicap})</option>
                                    ))}
                                </select>
                                {substitutePlayers.length === 0 && <p className="text-red-500 text-sm mt-1">No substitute players available. Please add some first.</p>}
                            </div>

                            <div className="modal-actions flex justify-end space-x-2">
                                <button
                                    onClick={handleConfirmSubstitution}
                                    className="btn-primary"
                                    disabled={!playerToSubstituteKey || !selectedSubstituteId}
                                >
                                    Confirm Substitution
                                </button>
                                <button onClick={() => setShowSubstituteModal(false)} className="btn-secondary">
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Score Entry Modal */}
                {showScoreEntryModal && matchForScoreEntry && (userRole === 'admin' || userRole === 'tournamentManager' || (
                    userRole === 'teamCaptain' && (
                        (teams.find(t => t.id === matchForScoreEntry.team1Id)?.player1Id === userId || teams.find(t => t.id === matchForScoreEntry.team1Id)?.player2Id === userId) ||
                        (teams.find(t => t.id === matchForScoreEntry.team2Id)?.player1Id === userId || teams.find(t => t.id === matchForScoreEntry.team2Id)?.player2Id === userId)
                    )
                )) && (
                    <div className="modal-overlay">
                        <div className="modal-content">
                            <h3>Enter Score for Match</h3>
                            <p>Date: {matchForScoreEntry.date}</p>
                            <p>Time: {matchForScoreEntry.time}</p>
                            <p>Court: {matchForScoreEntry.court}</p>
                            <p>Teams: <strong>{matchForScoreEntry.team1Name}</strong> vs <strong>{matchForScoreEntry.team2Name}</strong></p>

                            <div className="score-input-section mt-4">
                                <h4>Current Sets:</h4>
                                {scoreInput.team1Sets.length > 0 ? (
                                    <ul className="list-disc ml-5 mt-2">
                                        {scoreInput.team1Sets.map((s, i) => (
                                            <li key={i}>{matchForScoreEntry.team1Name}: {s} - {matchForScoreEntry.team2Name}: {scoreInput.team2Sets[i]}</li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p>No sets entered yet.</p>
                                )}
                                {scoreInput.team1Sets.length > 0 && (
                                    <button onClick={handleRemoveLastSet} className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 text-sm mt-2">
                                        Remove Last Set
                                    </button>
                                )}

                                <h4 className="mt-4">Add New Set Score:</h4>
                                <div className="flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-2 mt-2">
                                    <input
                                        type="number"
                                        placeholder={`${matchForScoreEntry.team1Name} Games`}
                                        value={currentSetScores.team1Games}
                                        onChange={(e) => handleSetScoreChange('team1Games', e.target.value)}
                                        className="input-field w-full sm:w-32"
                                    />
                                    <span> - </span>
                                    <input
                                        type="number"
                                        placeholder={`${matchForScoreEntry.team2Name} Games`}
                                        value={currentSetScores.team2Games}
                                        onChange={(e) => handleSetScoreChange('team2Games', e.target.value)}
                                        className="input-field w-full sm:w-32"
                                    />
                                    <button onClick={handleAddSetScore} className="btn-primary w-full sm:w-auto">
                                        Add Set
                                    </button>
                                </div>
                            </div>

                            <div className="modal-actions mt-4 flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-2">
                                <button
                                    onClick={handleSaveMatchScore}
                                    className="btn-primary"
                                    disabled={calculateMatchWinner(scoreInput.team1Sets, scoreInput.team2Sets) === null}
                                >
                                    Save Score & Conclude Match
                                </button>
                                <button onClick={handleCloseScoreEntryModal} className="btn-secondary">
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* AI Analysis Modal */}
                {showAiAnalysisModal && (
                    <div className="modal-overlay">
                        <div className="modal-content">
                            <h3>Match Analysis powered by AI</h3>
                            {isGeneratingAnalysis ? (
                                <div className="flex items-center justify-center py-8">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                                    <p className="ml-3 text-gray-700">Generating insights...</p>
                                </div>
                            ) : aiAnalysisResult ? (
                                <div className="prose max-w-none text-left" style={{ whiteSpace: 'pre-wrap' }}>
                                    <p>{aiAnalysisResult}</p>
                                </div>
                            ) : (
                                <p className="text-red-500">No analysis generated or an error occurred.</p>
                            )}

                            <div className="modal-actions mt-4 flex justify-end">
                                <button onClick={handleCloseAiAnalysisModal} className="btn-secondary">
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Optimal Pairings Modal */}
                {showOptimalPairingsModal && (
                    <div className="modal-overlay">
                        <div className="modal-content">
                            <h3>Optimal Match Pairings Suggestions (AI-Assisted)</h3>
                            {gettingOptimalPairings ? (
                                <div className="flex items-center justify-center py-8">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                                    <p className="ml-3 text-gray-700">Thinking of the best matchups...</p>
                                </div>
                            ) : optimalPairingsResult ? (
                                <div className="prose max-w-none text-left" style={{ whiteSpace: 'pre-wrap' }}>
                                    <p>{optimalPairingsResult}</p>
                                </div>
                            ) : (
                                <p className="text-red-500">No optimal pairings generated or an error occurred. Ensure you have generated teams first.</p>
                            )}

                            <div className="modal-actions mt-4 flex justify-end">
                                <button onClick={handleCloseOptimalPairingsModal} className="btn-secondary">
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};

export default App;

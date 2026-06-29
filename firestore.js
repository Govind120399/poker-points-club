import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

const GAMES = "pokerGames";
const USERS = "pokerUsers";
const MAX_LOG = 40;
const SUITS = ["S", "H", "D", "C"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const RANK_VALUE = Object.fromEntries(RANKS.map((rank, index) => [rank, index + 2]));
const HAND_NAMES = [
  "High Card",
  "One Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush",
];

function gameRef(gameId) {
  return doc(db, GAMES, gameId);
}

function handRef(gameId, userId) {
  return doc(db, GAMES, gameId, "hands", userId);
}

function userRef(userId) {
  return doc(db, USERS, userId);
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit, code: `${rank}${suit}` });
    }
  }
  return deck;
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function generateCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function trimLog(log) {
  return log.slice(-MAX_LOG);
}

function nextActiveSeat(players, fromSeat) {
  const active = players.filter((player) => player.stack > 0);
  if (!active.length) return -1;
  const seats = active.map((player) => player.seatIndex).sort((a, b) => a - b);
  for (const seat of seats) {
    if (seat > fromSeat) return seat;
  }
  return seats[0];
}

function findPlayer(players, seatIndex) {
  return players.find((player) => player.seatIndex === seatIndex);
}

function sortPlayers(players) {
  return [...players].sort((a, b) => a.seatIndex - b.seatIndex);
}

function livePlayers(players) {
  return players.filter((player) => !player.folded && player.committed > 0 && !player.removed);
}

function actingPlayers(players) {
  return players.filter((player) => !player.folded && !player.allIn && player.stack > 0 && !player.removed);
}

function findNextToAct(players, startSeat, currentBet) {
  const ordered = sortPlayers(players);
  if (!ordered.length) return -1;
  const seats = ordered.map((player) => player.seatIndex);
  const startIndex = Math.max(0, seats.indexOf(startSeat));
  for (let offset = 0; offset < seats.length; offset += 1) {
    const seat = seats[(startIndex + offset) % seats.length];
    const player = findPlayer(players, seat);
    if (!player || player.folded || player.allIn || player.stack <= 0 || player.removed) continue;
    if (!player.acted || player.streetBet !== currentBet) return seat;
  }
  return -1;
}

function isRoundComplete(players, currentBet) {
  const actionable = actingPlayers(players);
  if (!actionable.length) return true;
  return actionable.every((player) => player.acted && player.streetBet === currentBet);
}

function getStraightHigh(sortedValues) {
  const unique = [...new Set(sortedValues)].sort((a, b) => b - a);
  if (unique[0] === 14) unique.push(1);
  for (let i = 0; i <= unique.length - 5; i += 1) {
    const slice = unique.slice(i, i + 5);
    if (slice.every((value, index) => index === 0 || slice[index - 1] - 1 === value)) {
      return slice[0] === 1 ? 5 : slice[0];
    }
  }
  return null;
}

function rankFiveCardHand(cards) {
  const values = cards.map((card) => RANK_VALUE[card.rank]).sort((a, b) => b - a);
  const counts = values.reduce((map, value) => {
    map[value] = (map[value] || 0) + 1;
    return map;
  }, {});
  const countEntries = Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const straightHigh = getStraightHigh(values);

  if (flush && straightHigh) return { category: 8, values: [straightHigh] };
  if (countEntries[0].count === 4) {
    const kicker = countEntries.find((entry) => entry.count === 1).value;
    return { category: 7, values: [countEntries[0].value, kicker] };
  }
  if (countEntries[0].count === 3 && countEntries[1].count === 2) {
    return { category: 6, values: [countEntries[0].value, countEntries[1].value] };
  }
  if (flush) return { category: 5, values };
  if (straightHigh) return { category: 4, values: [straightHigh] };
  if (countEntries[0].count === 3) {
    const kickers = countEntries.filter((entry) => entry.count === 1).map((entry) => entry.value).sort((a, b) => b - a);
    return { category: 3, values: [countEntries[0].value, ...kickers] };
  }
  if (countEntries[0].count === 2 && countEntries[1].count === 2) {
    const pairs = countEntries.filter((entry) => entry.count === 2).map((entry) => entry.value).sort((a, b) => b - a);
    const kicker = countEntries.find((entry) => entry.count === 1).value;
    return { category: 2, values: [...pairs, kicker] };
  }
  if (countEntries[0].count === 2) {
    const pair = countEntries[0].value;
    const kickers = countEntries.filter((entry) => entry.count === 1).map((entry) => entry.value).sort((a, b) => b - a);
    return { category: 1, values: [pair, ...kickers] };
  }
  return { category: 0, values };
}

function compareHands(left, right) {
  if (left.category !== right.category) return left.category - right.category;
  const longest = Math.max(left.values.length, right.values.length);
  for (let i = 0; i < longest; i += 1) {
    const diff = (left.values[i] || 0) - (right.values[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function combinations(items, size) {
  const result = [];
  const path = [];
  function walk(start) {
    if (path.length === size) {
      result.push([...path]);
      return;
    }
    for (let i = start; i < items.length; i += 1) {
      path.push(items[i]);
      walk(i + 1);
      path.pop();
    }
  }
  walk(0);
  return result;
}

function evaluateSevenCards(cards) {
  let best = null;
  for (const combo of combinations(cards, 5)) {
    const ranked = rankFiveCardHand(combo);
    if (!best || compareHands(ranked, best) > 0) best = ranked;
  }
  return best;
}

function buildSidePots(players) {
  const levels = [...new Set(players.map((player) => player.committed).filter(Boolean))].sort((a, b) => a - b);
  const pots = [];
  let previous = 0;
  let sideIndex = 1;
  for (const level of levels) {
    const involved = players.filter((player) => player.committed >= level);
    const amount = (level - previous) * involved.length;
    const eligibleIds = involved.filter((player) => !player.folded).map((player) => player.userId);
    if (amount > 0 && eligibleIds.length) {
      pots.push({
        amount,
        eligibleIds,
        label: pots.length === 0 ? "Main pot" : `Side pot ${sideIndex++}`,
      });
    }
    previous = level;
  }
  return pots;
}

export async function ensureUserProfile(authUser, preferredName = "") {
  const ref = userRef(authUser.uid);
  const snapshot = await getDoc(ref);
  const existing = snapshot.exists() ? snapshot.data() : {};
  const profile = {
    name: preferredName.trim() || existing.name || authUser.displayName || authUser.email?.split("@")[0] || "Player",
    email: authUser.email || existing.email || "",
    createdAt: existing.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, profile, { merge: true });
  return { id: authUser.uid, name: profile.name, email: profile.email };
}

export async function createTable({ hostId, hostName, tableName, startingStack, smallBlind, bigBlind }) {
  const ref = doc(collection(db, GAMES));
  const code = generateCode();
  const hostPlayer = {
    userId: hostId,
    name: hostName,
    seatIndex: 0,
    stack: Number(startingStack),
    totalWins: 0,
    busted: false,
    folded: false,
    allIn: false,
    streetBet: 0,
    committed: 0,
    acted: false,
    lastAction: "Host",
    bestHandName: "",
    removed: false,
  };
  await setDoc(ref, {
    name: tableName.trim(),
    code,
    hostId,
    status: "waiting",
    handNumber: 0,
    street: "waiting",
    pot: 0,
    currentBet: 0,
    minRaise: Number(bigBlind),
    dealerIndex: -1,
    turnSeat: -1,
    community: [],
    deckState: [],
    config: {
      startingStack: Number(startingStack),
      smallBlind: Number(smallBlind),
      bigBlind: Number(bigBlind),
      maxPlayers: 10,
    },
    players: [hostPlayer],
    log: ["Table created. Waiting for players to join."],
    results: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: ref.id, code };
}

export async function joinTableByCode(code, profile) {
  const snapshot = await getDocs(query(collection(db, GAMES), where("code", "==", code.trim().toUpperCase()), limit(1)));
  if (snapshot.empty) throw new Error("Table not found. Check the room code.");
  const game = snapshot.docs[0];
  const data = game.data();
  const players = sortPlayers(data.players || []);
  if (players.some((player) => player.userId === profile.id && !player.removed)) return game.id;
  if (players.filter((player) => !player.removed).length >= (data.config?.maxPlayers || 10)) throw new Error("This table is full.");
  const seatIndex = players.length ? players[players.length - 1].seatIndex + 1 : 0;
  const nextPlayer = {
    userId: profile.id,
    name: profile.name,
    seatIndex,
    stack: Number(data.config?.startingStack || 1000),
    totalWins: 0,
    busted: false,
    folded: false,
    allIn: false,
    streetBet: 0,
    committed: 0,
    acted: false,
    lastAction: "Joined",
    bestHandName: "",
    removed: false,
  };
  await updateDoc(game.ref, {
    players: [...players, nextPlayer],
    log: trimLog([...(data.log || []), `${profile.name} joined the table.`]),
    updatedAt: serverTimestamp(),
  });
  return game.id;
}

export function subscribeToTable(gameId, onData) {
  return onSnapshot(gameRef(gameId), (snapshot) => {
    onData(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
  });
}

export function subscribeToPrivateHand(gameId, userId, onData) {
  return onSnapshot(handRef(gameId, userId), (snapshot) => {
    onData(snapshot.exists() ? snapshot.data() : null);
  });
}

export async function leaveTable(gameId, userId) {
  await runTransaction(db, async (transaction) => {
    const ref = gameRef(gameId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    const players = sortPlayers(data.players || []).map((player) =>
      player.userId === userId ? { ...player, removed: true, folded: true, allIn: false, acted: true, lastAction: "Left table" } : player,
    );
    transaction.update(ref, {
      players,
      log: trimLog([...(data.log || []), `${players.find((player) => player.userId === userId)?.name || "A player"} left the table.`]),
      updatedAt: serverTimestamp(),
    });
  });
}

export async function startHand(gameId, hostId) {
  const ref = gameRef(gameId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error("Table not found.");
  const game = snapshot.data();
  if (game.hostId !== hostId) throw new Error("Only the host can start a hand.");
  const players = sortPlayers((game.players || []).filter((player) => !player.removed));
  const eligible = players.filter((player) => player.stack > 0);
  if (eligible.length < 2) throw new Error("At least two players with points are needed.");

  const deck = shuffle(createDeck());
  const dealerIndex = nextActiveSeat(players, game.dealerIndex ?? -1);
  const smallBlindSeat = nextActiveSeat(players, dealerIndex);
  const bigBlindSeat = nextActiveSeat(players, smallBlindSeat);
  const actingOrderStart = nextActiveSeat(players, bigBlindSeat);

  const nextPlayers = players.map((player) => ({
    ...player,
    busted: player.stack <= 0,
    folded: player.stack <= 0,
    allIn: false,
    streetBet: 0,
    committed: 0,
    acted: false,
    lastAction: player.stack <= 0 ? "Sitting out" : "Waiting",
    bestHandName: "",
  }));

  const hands = {};
  for (const player of eligible) {
    hands[player.userId] = [deck.pop(), deck.pop()];
  }

  function postBlind(seat, label, amount) {
    const player = nextPlayers.find((entry) => entry.seatIndex === seat);
    if (!player) return;
    const posted = Math.min(player.stack, amount);
    player.stack -= posted;
    player.streetBet += posted;
    player.committed += posted;
    player.allIn = player.stack === 0;
    player.lastAction = `${label} ${posted} pts`;
  }

  postBlind(smallBlindSeat, "SB", Number(game.config.smallBlind));
  postBlind(bigBlindSeat, "BB", Number(game.config.bigBlind));

  const currentBet = Math.max(...nextPlayers.map((player) => player.streetBet));
  const turnSeat = findNextToAct(nextPlayers, actingOrderStart, currentBet);
  const batch = writeBatch(db);
  Object.entries(hands).forEach(([userId, cards]) => {
    batch.set(handRef(gameId, userId), {
      cards,
      revealed: false,
      updatedAt: serverTimestamp(),
    });
  });
  batch.update(ref, {
    players: nextPlayers,
    handNumber: Number(game.handNumber || 0) + 1,
    status: "active",
    street: "preflop",
    pot: nextPlayers.reduce((total, player) => total + player.committed, 0),
    currentBet,
    minRaise: Number(game.config.bigBlind),
    dealerIndex,
    turnSeat,
    community: [],
    deckState: deck,
    results: [],
    log: trimLog([...(game.log || []), `Hand ${(game.handNumber || 0) + 1} started. Dealer: ${findPlayer(nextPlayers, dealerIndex)?.name || "Unknown"}.`]),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

function dealNextStreet(game, players) {
  const deck = [...game.deckState];
  const community = [...game.community];
  if (game.street === "preflop") {
    community.push(deck.pop(), deck.pop(), deck.pop());
    return { street: "flop", community, deck, message: "Flop dealt." };
  }
  if (game.street === "flop") {
    community.push(deck.pop());
    return { street: "turn", community, deck, message: "Turn dealt." };
  }
  community.push(deck.pop());
  return { street: "river", community, deck, message: "River dealt." };
}

export async function submitAction(gameId, userId, action, amount = 0) {
  await runTransaction(db, async (transaction) => {
    const ref = gameRef(gameId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error("Table not found.");
    const game = snapshot.data();
    if (game.status !== "active") throw new Error("This hand is not active.");

    const players = sortPlayers(game.players || []);
    const seatPlayer = players.find((player) => player.userId === userId && !player.removed);
    if (!seatPlayer) throw new Error("You are not seated at this table.");
    if (game.turnSeat !== seatPlayer.seatIndex) throw new Error("It is not your turn.");

    const player = seatPlayer;
    const toCall = Math.max(0, Number(game.currentBet || 0) - player.streetBet);
    const numericAmount = Number(amount) || 0;
    const logs = [...(game.log || [])];
    const appendLog = (entry) => logs.push(entry);

    if (action === "fold") {
      player.folded = true;
      player.acted = true;
      player.lastAction = "Fold";
      appendLog(`${player.name} folds.`);
    } else if (action === "check") {
      if (toCall !== 0) throw new Error("You cannot check right now.");
      player.acted = true;
      player.lastAction = "Check";
      appendLog(`${player.name} checks.`);
    } else if (action === "call") {
      const paid = Math.min(player.stack, toCall);
      player.stack -= paid;
      player.streetBet += paid;
      player.committed += paid;
      player.allIn = player.stack === 0;
      player.acted = true;
      player.lastAction = player.allIn ? "Call all-in" : `Call ${paid} pts`;
      appendLog(`${player.name} calls ${paid} pts.`);
    } else if (action === "bet") {
      if (Number(game.currentBet || 0) !== 0) throw new Error("Use raise instead of bet.");
      if (numericAmount < Number(game.config.bigBlind || 0)) throw new Error("Bet is below the minimum.");
      const paid = Math.min(player.stack, numericAmount);
      player.stack -= paid;
      player.streetBet += paid;
      player.committed += paid;
      player.allIn = player.stack === 0;
      player.acted = true;
      player.lastAction = `Bet ${player.streetBet} pts`;
      players.forEach((entry) => {
        if (entry.userId !== player.userId && !entry.folded && !entry.allIn && !entry.removed) entry.acted = false;
      });
      game.currentBet = player.streetBet;
      game.minRaise = paid;
      appendLog(`${player.name} bets ${paid} pts.`);
    } else if (action === "raise") {
      const totalTarget = numericAmount;
      const raiseSize = totalTarget - Number(game.currentBet || 0);
      if (totalTarget <= Number(game.currentBet || 0) || raiseSize < Number(game.minRaise || 0)) throw new Error("Raise is too small.");
      const needed = totalTarget - player.streetBet;
      const paid = Math.min(player.stack, needed);
      player.stack -= paid;
      player.streetBet += paid;
      player.committed += paid;
      player.allIn = player.stack === 0;
      player.acted = true;
      player.lastAction = `Raise to ${player.streetBet} pts`;
      players.forEach((entry) => {
        if (entry.userId !== player.userId && !entry.folded && !entry.allIn && !entry.removed) entry.acted = false;
      });
      game.minRaise = raiseSize;
      game.currentBet = player.streetBet;
      appendLog(`${player.name} raises to ${player.streetBet} pts.`);
    } else if (action === "allin") {
      const total = player.streetBet + player.stack;
      player.committed += player.stack;
      player.streetBet = total;
      player.stack = 0;
      player.allIn = true;
      player.acted = true;
      if (total > Number(game.currentBet || 0)) {
        const raiseSize = total - Number(game.currentBet || 0);
        if (raiseSize >= Number(game.minRaise || 0)) {
          players.forEach((entry) => {
            if (entry.userId !== player.userId && !entry.folded && !entry.allIn && !entry.removed) entry.acted = false;
          });
          game.minRaise = raiseSize;
        }
        game.currentBet = total;
      }
      player.lastAction = `All-in ${total} pts`;
      appendLog(`${player.name} goes all-in to ${total} pts.`);
    } else {
      throw new Error("Unknown action.");
    }

    game.pot = players.reduce((total, entry) => total + entry.committed, 0);

    if (livePlayers(players).length === 1) {
      const winner = livePlayers(players)[0];
      winner.stack += game.pot;
      winner.totalWins += game.pot;
      players.forEach((entry) => {
        entry.busted = entry.stack <= 0;
        if (entry.userId === winner.userId) entry.lastAction = "Won uncontested";
      });
      transaction.update(ref, {
        players,
        status: "finished",
        street: "finished",
        turnSeat: -1,
        pot: 0,
        currentBet: 0,
        results: [`${winner.name} wins ${game.pot} pts uncontested.`],
        log: trimLog([...logs, `${winner.name} wins ${game.pot} pts uncontested.`]),
        updatedAt: serverTimestamp(),
      });
      return;
    }

    if (isRoundComplete(players, Number(game.currentBet || 0))) {
      players.forEach((entry) => {
        entry.streetBet = 0;
        if (!entry.folded && !entry.allIn && !entry.removed) entry.acted = false;
      });
      game.currentBet = 0;
      game.minRaise = Number(game.config.bigBlind || 0);

      if (game.street === "river") {
        transaction.update(ref, {
          players,
          status: "showdown_pending",
          street: "showdown",
          turnSeat: -1,
          pot: game.pot,
          currentBet: 0,
          minRaise: Number(game.config.bigBlind || 0),
          results: ["Betting complete. Host can now resolve showdown."],
          log: trimLog([...logs, "Betting complete. Waiting for host to resolve showdown."]),
          updatedAt: serverTimestamp(),
        });
        return;
      }

      const deck = [...(game.deckState || [])];
      const community = [...(game.community || [])];
      if (game.street === "preflop") {
        community.push(deck.pop(), deck.pop(), deck.pop());
        game.street = "flop";
        appendLog("Flop dealt.");
      } else if (game.street === "flop") {
        community.push(deck.pop());
        game.street = "turn";
        appendLog("Turn dealt.");
      } else if (game.street === "turn") {
        community.push(deck.pop());
        game.street = "river";
        appendLog("River dealt.");
      }

      const firstSeat = nextActiveSeat(players, game.dealerIndex);
      const turnSeat = findNextToAct(players, firstSeat, 0);
      transaction.update(ref, {
        players,
        status: "active",
        street: game.street,
        community,
        deckState: deck,
        turnSeat,
        pot: game.pot,
        currentBet: 0,
        minRaise: Number(game.config.bigBlind || 0),
        log: trimLog(logs),
        updatedAt: serverTimestamp(),
      });
      return;
    }

    const nextSeat = findNextToAct(players, nextActiveSeat(players, player.seatIndex), Number(game.currentBet || 0));
    transaction.update(ref, {
      players,
      pot: game.pot,
      currentBet: Number(game.currentBet || 0),
      minRaise: Number(game.minRaise || game.config.bigBlind || 0),
      turnSeat: nextSeat,
      log: trimLog(logs),
      updatedAt: serverTimestamp(),
    });
  });
}

export async function resolveShowdown(gameId, hostId) {
  const ref = gameRef(gameId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error("Table not found.");
  const game = snapshot.data();
  if (game.hostId !== hostId) throw new Error("Only the host can resolve showdown.");
  if (game.status !== "showdown_pending" && game.status !== "active") throw new Error("Showdown is not ready.");

  const players = sortPlayers(game.players || []);
  const contenders = players.filter((player) => !player.folded && player.committed > 0 && !player.removed);
  const handSnapshots = await Promise.all(contenders.map((player) => getDoc(handRef(gameId, player.userId))));
  const privateHands = Object.fromEntries(
    handSnapshots.filter((entry) => entry.exists()).map((entry) => [entry.id, entry.data().cards || []]),
  );

  contenders.forEach((player) => {
    player.bestHand = evaluateSevenCards([...(privateHands[player.userId] || []), ...(game.community || [])]);
    player.bestHandName = HAND_NAMES[player.bestHand.category];
    player.lastAction = player.bestHandName;
  });

  const pots = buildSidePots(contenders);
  const results = [];

  for (const pot of pots) {
    const eligible = contenders.filter((player) => pot.eligibleIds.includes(player.userId));
    eligible.sort((a, b) => compareHands(b.bestHand, a.bestHand));
    const best = eligible[0].bestHand;
    const winners = eligible.filter((player) => compareHands(player.bestHand, best) === 0);
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    winners.forEach((winner) => {
      const payout = share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      winner.stack += payout;
      winner.totalWins += payout;
    });
    results.push(`${pot.label}: ${winners.map((winner) => winner.name).join(", ")} win ${pot.amount} pts with ${HAND_NAMES[best.category]}.`);
  }

  players.forEach((player) => {
    player.busted = player.stack <= 0;
    player.streetBet = 0;
    player.committed = 0;
    player.acted = false;
    player.folded = player.busted;
    player.allIn = false;
  });

  await updateDoc(ref, {
    players,
    status: "finished",
    street: "finished",
    turnSeat: -1,
    pot: 0,
    currentBet: 0,
    minRaise: Number(game.config.bigBlind || 0),
    results,
    log: trimLog([...(game.log || []), ...results]),
    updatedAt: serverTimestamp(),
  });
}

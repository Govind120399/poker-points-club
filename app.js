import { auth } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import {
  createTable,
  ensureUserProfile,
  joinTableByCode,
  leaveTable,
  resolveShowdown,
  startHand,
  submitAction,
  subscribeToPrivateHand,
  subscribeToTable,
} from "./firestore.js";

const STREET_LABELS = {
  waiting: "Waiting",
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
  finished: "Finished",
};
const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };

const state = {
  me: null,
  profile: null,
  game: null,
  myHand: null,
  tableUnsub: null,
  handUnsub: null,
  currentGameId: null,
};

const dom = {
  authPanel: document.getElementById("auth-panel"),
  lobbyPanel: document.getElementById("lobby-panel"),
  tablePanel: document.getElementById("table-panel"),
  authEmail: document.getElementById("auth-email"),
  authPassword: document.getElementById("auth-password"),
  authName: document.getElementById("auth-name"),
  signupButton: document.getElementById("signup-button"),
  loginButton: document.getElementById("login-button"),
  guestButton: document.getElementById("guest-button"),
  authMessage: document.getElementById("auth-message"),
  sessionLabel: document.getElementById("session-label"),
  logoutButton: document.getElementById("logout-button"),
  createTableName: document.getElementById("create-table-name"),
  createStartingStack: document.getElementById("create-starting-stack"),
  createSmallBlind: document.getElementById("create-small-blind"),
  createBigBlind: document.getElementById("create-big-blind"),
  createTableButton: document.getElementById("create-table-button"),
  joinCode: document.getElementById("join-code"),
  joinTableButton: document.getElementById("join-table-button"),
  lobbyMessage: document.getElementById("lobby-message"),
  tableTitle: document.getElementById("table-title"),
  tableStatus: document.getElementById("table-status"),
  tableCodePill: document.getElementById("table-code-pill"),
  leaveTableButton: document.getElementById("leave-table-button"),
  potValue: document.getElementById("pot-value"),
  streetValue: document.getElementById("street-value"),
  betValue: document.getElementById("bet-value"),
  turnValue: document.getElementById("turn-value"),
  handMessage: document.getElementById("hand-message"),
  communityCards: document.getElementById("community-cards"),
  mySeat: document.getElementById("my-seat"),
  hostControls: document.getElementById("host-controls"),
  playersTable: document.getElementById("players-table"),
  actionControls: document.getElementById("action-controls"),
  resultsBox: document.getElementById("results-box"),
  actionLog: document.getElementById("action-log"),
};

function init() {
  dom.signupButton.addEventListener("click", onSignup);
  dom.loginButton.addEventListener("click", onLogin);
  dom.guestButton.addEventListener("click", onGuest);
  dom.logoutButton.addEventListener("click", async () => {
    await signOut(auth);
  });
  dom.createTableButton.addEventListener("click", onCreateTable);
  dom.joinTableButton.addEventListener("click", onJoinTable);
  dom.leaveTableButton.addEventListener("click", onLeaveTable);

  onAuthStateChanged(auth, async (user) => {
    cleanupSubscriptions();
    state.me = user;
    state.game = null;
    state.myHand = null;
    state.currentGameId = null;

    if (!user) {
      state.profile = null;
      setAuthMessage("");
      setLobbyMessage("");
      render();
      return;
    }

    state.profile = await ensureUserProfile(user, dom.authName.value.trim());
    dom.sessionLabel.textContent = `Signed in as ${state.profile.name}`;
    render();
  });
}

function cleanupSubscriptions() {
  state.tableUnsub?.();
  state.handUnsub?.();
  state.tableUnsub = null;
  state.handUnsub = null;
}

async function onSignup() {
  try {
    const email = dom.authEmail.value.trim();
    const password = dom.authPassword.value.trim();
    const name = dom.authName.value.trim();
    if (!email || !password || !name) throw new Error("Email, password, and display name are required.");
    await createUserWithEmailAndPassword(auth, email, password);
    setAuthMessage("Account created. You can now create or join a table.", false);
  } catch (error) {
    setAuthMessage(readAuthError(error), true);
  }
}

async function onLogin() {
  try {
    await signInWithEmailAndPassword(auth, dom.authEmail.value.trim(), dom.authPassword.value.trim());
    setAuthMessage("", false);
  } catch (error) {
    setAuthMessage(readAuthError(error), true);
  }
}

async function onGuest() {
  try {
    await signInAnonymously(auth);
    await ensureUserProfile(auth.currentUser, dom.authName.value.trim() || `Guest ${Math.floor(Math.random() * 900 + 100)}`);
    setAuthMessage("", false);
  } catch (error) {
    setAuthMessage("Unable to start guest mode right now.", true);
  }
}

async function onCreateTable() {
  try {
    ensureProfile();
    const table = await createTable({
      hostId: state.profile.id,
      hostName: state.profile.name,
      tableName: dom.createTableName.value.trim() || "Poker Points Table",
      startingStack: Number(dom.createStartingStack.value),
      smallBlind: Number(dom.createSmallBlind.value),
      bigBlind: Number(dom.createBigBlind.value),
    });
    attachGame(table.id);
    setLobbyMessage("", false);
  } catch (error) {
    setLobbyMessage(error.message || "Unable to create table.", true);
  }
}

async function onJoinTable() {
  try {
    ensureProfile();
    const gameId = await joinTableByCode(dom.joinCode.value.trim(), state.profile);
    attachGame(gameId);
    setLobbyMessage("", false);
  } catch (error) {
    setLobbyMessage(error.message || "Unable to join table.", true);
  }
}

async function onLeaveTable() {
  try {
    if (!state.currentGameId || !state.profile) return;
    await leaveTable(state.currentGameId, state.profile.id);
    cleanupSubscriptions();
    state.game = null;
    state.myHand = null;
    state.currentGameId = null;
    render();
  } catch (error) {
    setLobbyMessage(error.message || "Unable to leave table.", true);
  }
}

function attachGame(gameId) {
  cleanupSubscriptions();
  state.currentGameId = gameId;
  state.tableUnsub = subscribeToTable(gameId, (game) => {
    state.game = game;
    render();
  });
  state.handUnsub = subscribeToPrivateHand(gameId, state.profile.id, (hand) => {
    state.myHand = hand;
    render();
  });
}

function ensureProfile() {
  if (!state.profile) throw new Error("Sign in first.");
}

function setAuthMessage(message, isError = false) {
  dom.authMessage.textContent = message;
  dom.authMessage.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function setLobbyMessage(message, isError = false) {
  dom.lobbyMessage.textContent = message;
  dom.lobbyMessage.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function myPlayer() {
  return state.game?.players?.find((player) => player.userId === state.profile?.id && !player.removed) || null;
}

function isHost() {
  return state.game?.hostId === state.profile?.id;
}

function currentTurnPlayer() {
  return state.game?.players?.find((player) => player.seatIndex === state.game?.turnSeat) || null;
}

function render() {
  const signedIn = Boolean(state.profile);
  const atTable = signedIn && Boolean(state.game);
  dom.authPanel.classList.toggle("hidden", signedIn);
  dom.lobbyPanel.classList.toggle("hidden", !signedIn || atTable);
  dom.tablePanel.classList.toggle("hidden", !atTable);
  if (!atTable) return;
  renderTable();
}

function renderTable() {
  const game = state.game;
  const me = myPlayer();
  const turn = currentTurnPlayer();
  dom.tableTitle.textContent = game.name;
  dom.tableStatus.textContent = `Hand ${game.handNumber || 0} • Blinds ${game.config.smallBlind} / ${game.config.bigBlind}`;
  dom.tableCodePill.textContent = `Code: ${game.code}`;
  dom.potValue.textContent = `${game.pot || 0} pts`;
  dom.streetValue.textContent = STREET_LABELS[game.street] || "Waiting";
  dom.betValue.textContent = `${game.currentBet || 0} pts`;
  dom.turnValue.textContent = turn?.name || "-";
  dom.handMessage.textContent = game.results?.[0] || (game.status === "active" ? "Hand in progress" : "Waiting for host");
  dom.communityCards.innerHTML = renderCommunityCards(game.community || []);
  dom.playersTable.innerHTML = renderPlayers(game.players || []);
  dom.actionLog.innerHTML = (game.log || []).length ? [...game.log].reverse().map((line) => `<div class="log-line">${line}</div>`).join("") : `<div class="empty-state">No action yet.</div>`;
  dom.resultsBox.innerHTML = (game.results || []).length ? game.results.map((line) => `<div class="result-line">${line}</div>`).join("") : `<div class="empty-state">No showdown yet.</div>`;
  dom.mySeat.innerHTML = me ? renderMySeat(me) : `<div class="empty-state">You are no longer seated at this table.</div>`;
  dom.hostControls.innerHTML = isHost() ? renderHostControls() : `<div class="empty-state">Only the host sees table controls.</div>`;
  bindHostControls();
  dom.actionControls.innerHTML = renderActionControls(me, turn);
  bindActionControls(me, turn);
}

function renderCommunityCards(cards) {
  const filled = [...cards];
  while (filled.length < 5) filled.push(null);
  return filled.map(renderCard).join("");
}

function renderMySeat(player) {
  const cards = state.myHand?.cards || [];
  return `
    <div class="result-line">
      <strong>${player.name}</strong>
      <div class="privacy-note">Only your signed-in session can see these two cards.</div>
    </div>
    <div class="player-meta">
      <div><span class="meta-label">Stack</span><strong>${player.stack} pts</strong></div>
      <div><span class="meta-label">In pot</span><strong>${player.committed} pts</strong></div>
      <div><span class="meta-label">Street</span><strong>${player.streetBet} pts</strong></div>
      <div><span class="meta-label">Status</span><strong>${player.lastAction || "Waiting"}</strong></div>
    </div>
    <div class="hole-cards">
      ${cards.length ? cards.map(renderCard).join("") : `${renderBack()}${renderBack()}`}
    </div>
  `;
}

function renderPlayers(players) {
  return [...players]
    .filter((player) => !player.removed)
    .sort((a, b) => a.seatIndex - b.seatIndex)
    .map((player) => {
      const turnClass = player.seatIndex === state.game.turnSeat ? "active-turn" : "";
      const hiddenCards = player.userId === state.profile.id ? (state.myHand?.cards || []).map(renderCard).join("") : `${renderBack()}${renderBack()}`;
      return `
        <article class="player-card ${turnClass} ${player.folded ? "folded" : ""} ${player.busted ? "busted" : ""}">
          <div class="player-header row-between">
            <div>
              <strong>${player.name}${player.userId === state.profile.id ? " (you)" : ""}</strong>
              <div class="muted">${player.lastAction || "Waiting"}</div>
            </div>
            <div class="seat-badges">
              ${player.userId === state.game.hostId ? `<span class="seat-badge gold">Host</span>` : ""}
              ${player.folded ? `<span class="seat-badge danger">Folded</span>` : ""}
              ${player.allIn ? `<span class="seat-badge danger">All-in</span>` : ""}
            </div>
          </div>
          <div class="player-meta">
            <div><span class="meta-label">Stack</span><strong>${player.stack} pts</strong></div>
            <div><span class="meta-label">In pot</span><strong>${player.committed} pts</strong></div>
            <div><span class="meta-label">Seat</span><strong>${player.seatIndex + 1}</strong></div>
            <div><span class="meta-label">Wins</span><strong>${player.totalWins} pts</strong></div>
          </div>
          <div class="hole-cards">${hiddenCards}</div>
        </article>
      `;
    })
    .join("");
}

function renderHostControls() {
  const canStart = state.game.status === "waiting" || state.game.status === "finished";
  const canResolve = state.game.status === "showdown_pending";
  return `
    <div class="row">
      <button class="primary-button" id="host-start-hand" type="button" ${canStart ? "" : "disabled"}>Deal next hand</button>
      <button class="secondary-button" id="host-resolve-showdown" type="button" ${canResolve ? "" : "disabled"}>Resolve showdown</button>
    </div>
    <p class="helper">Host deals hands and resolves showdown. Player devices still act for themselves on their own turns.</p>
  `;
}

function bindHostControls() {
  const start = document.getElementById("host-start-hand");
  const resolve = document.getElementById("host-resolve-showdown");
  start?.addEventListener("click", async () => {
    try {
      await startHand(state.currentGameId, state.profile.id);
    } catch (error) {
      setLobbyMessage(error.message || "Unable to start hand.", true);
    }
  });
  resolve?.addEventListener("click", async () => {
    try {
      await resolveShowdown(state.currentGameId, state.profile.id);
    } catch (error) {
      setLobbyMessage(error.message || "Unable to resolve showdown.", true);
    }
  });
}

function renderActionControls(me, turn) {
  if (!me) return `<div class="empty-state">You are not seated.</div>`;
  if (state.game.status !== "active") return `<div class="empty-state">No live action right now.</div>`;
  if (!turn || turn.userId !== state.profile.id) return `<div class="empty-state">Waiting for ${turn?.name || "another player"}.</div>`;
  const toCall = Math.max(0, (state.game.currentBet || 0) - (me.streetBet || 0));
  const minTarget = state.game.currentBet === 0 ? state.game.config.bigBlind : state.game.currentBet + state.game.minRaise;
  return `
    <div class="action-zone">
      <div class="result-line">
        <strong>Your turn.</strong><br>
        Need ${toCall} pts to call. Minimum ${state.game.currentBet === 0 ? "bet" : "raise to"} ${minTarget} pts.
      </div>
      <div class="amount-row">
        <input id="action-amount" type="number" min="0" step="5" value="${minTarget}">
        <button class="secondary-button" id="action-allin-fill" type="button">Use all-in</button>
      </div>
      <div class="action-grid">
        <button class="action-button danger" data-action="fold">Fold</button>
        <button class="action-button" data-action="${toCall === 0 ? "check" : "call"}">${toCall === 0 ? "Check" : `Call ${toCall}`}</button>
        <button class="action-button primary" data-action="${state.game.currentBet === 0 ? "bet" : "raise"}">${state.game.currentBet === 0 ? "Bet" : "Raise"}</button>
        <button class="action-button warning" data-action="allin">All-in</button>
      </div>
    </div>
  `;
}

function bindActionControls(me, turn) {
  if (!me || !turn || turn.userId !== state.profile.id || state.game.status !== "active") return;
  const amountInput = document.getElementById("action-amount");
  document.getElementById("action-allin-fill")?.addEventListener("click", () => {
    amountInput.value = (me.streetBet || 0) + (me.stack || 0);
  });
  dom.actionControls.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await submitAction(state.currentGameId, state.profile.id, button.dataset.action, Number(amountInput.value));
      } catch (error) {
        setLobbyMessage(error.message || "Unable to submit action.", true);
      }
    });
  });
}

function renderCard(card) {
  if (!card) return `<div class="card-slot">?</div>`;
  const red = card.suit === "H" || card.suit === "D";
  return `<div class="card-face ${red ? "red" : ""}">${card.rank}${SUIT_SYMBOL[card.suit]}</div>`;
}

function renderBack() {
  return `<div class="card-back">Hidden</div>`;
}

function readAuthError(error) {
  switch (error?.code) {
    case "auth/email-already-in-use":
      return "That email is already registered.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/invalid-credential":
      return "Wrong email or password.";
    default:
      return "Something went wrong. Please try again.";
  }
}

init();

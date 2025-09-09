// app.js — Pos Trainer V5
//
// Este archivo controla la lógica de la aplicación. Implementa tres modos de juego:
// 1) Posición → Asiento: se ilumina un botón de posición y el usuario debe pulsar el asiento correcto.
// 2) Asiento → Posición: se ilumina un asiento y el usuario debe pulsar el botón de posición correcto.
// 3) OR · IP/OOP: se simula una acción preflop (OR + calls/folds) y el usuario debe indicar quién está IP u OOP.
// Además, se mantiene siempre visible la botonera de posiciones: cuando el selector de jugadores cambia,
// simplemente se inhabilitan las posiciones que no existen en esa configuración de jugadores.

const App = (() => {
  // ----- Estado global -----
  const state = {
    config: {
      players: 6,          // número de jugadores activos
      timerSec: 10,        // duración del temporizador en segundos
      showLabels: true,    // mostrar etiquetas sobre los asientos
      ringVisible: true,   // mostrar anillo de cuenta atrás
      dist: 'uniform',     // distribución (por ahora sin uso)
      namingSet: 'B',      // conjunto de nomenclaturas ('A' o 'B')
      // modos de juego: 'posToSeat', 'seatToPos', 'seatIp' (asiento → IP/OOP), 'ipToSeat' (IP/OOP → asiento)
      mode: 'posToSeat'
    },
    btnSeat: 0,            // índice del asiento con el botón (dealer)
    activeSeats: Array(10).fill(false), // seats activos
    labels: Array(10).fill(''),         // etiquetas para cada asiento
    question: null,        // información de la pregunta actual
    timeLeft: 10,          // tiempo restante para la pregunta en curso
    ringLength: 0,         // longitud del círculo SVG (para animar el anillo)
    lastTick: null,        // marca temporal del último tick
    // Acciones para cada asiento en el modo OR/IP/OOP ("OR", "call", "3bet", "fold" o '')
    actions: Array(10).fill('')
  };

  // ----- Referencias al DOM -----
  const dom = {
    table: document.getElementById('table'),
    ring: document.getElementById('ring'),
    chips: document.getElementById('chips'),
    question: document.getElementById('question'),
    // Elementos para el selector de jugadores y temporizador (spinners)
    playersVal: document.getElementById('playersVal'),
    playersDec: document.getElementById('playersDec'),
    playersInc: document.getElementById('playersInc'),
    timerVal: document.getElementById('timerVal'),
    timerDec: document.getElementById('timerDec'),
    timerInc: document.getElementById('timerInc'),
    // Elemento para alternar la distribución (uniforme/sesgada)
    distToggle: document.getElementById('distToggle'),
    toggleNaming: document.getElementById('toggleNaming'),
    namingLabel: document.getElementById('namingLabel'),
    modeSeatFromPos: document.getElementById('modeSeatFromPos'),
    modePosFromSeat: document.getElementById('modePosFromSeat'),
    modeSeatIP: document.getElementById('modeSeatIP'),
    modeIPSeat: document.getElementById('modeIPSeat'),
    posButtons: document.getElementById('posButtons'),
    progressPath: document.getElementById('progressPath')
    // Nueva capa de destello para teñir la mesa de rojo
    ,flashOverlay: document.getElementById('flashOverlay')
    // Círculo de estela del temporizador
    ,trailPath: document.getElementById('trailPath')
    ,ipButtons: document.getElementById('ipButtons')
    ,btnIP: document.getElementById('btnIP')
    ,btnOOP: document.getElementById('btnOOP')
  };

  // ----- Utilidades -----
  const U = {
    // Número entero aleatorio en [a,b]
    randInt: (a, b) => Math.floor(Math.random() * (b - a + 1)) + a,
    // Barajar un array in situ y devolverlo
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    // Posición (x,y) en porcentaje para un asiento i de n asientos con radio r (por defecto 42)
    // Posición (x,y) en porcentaje para un asiento i de n asientos.
    // Se mantiene el radio por defecto en 42 para acomodar círculos más grandes.
    seatPos: (i, n, r = 42) => {
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      return {
        x: 50 + r * Math.cos(ang),
        y: 50 + r * Math.sin(ang)
      };
    },
    // Orden de acción postflop a partir del botón
    postflopOrder: (seats, btn) => {
      // devuelve array de asientos en orden de acción (el primero en hablar es el que está a la izquierda de la big blind)
      if (seats.length === 0) return [];
      const i = seats.indexOf(btn);
      const first = seats[(i + 1) % seats.length];
      const out = [];
      for (let k = 0; k < seats.length; k++) {
        out.push(seats[(seats.indexOf(first) + k) % seats.length]);
      }
      return out;
    }
  };

  /**
   * Genera una distribución realista de acciones preflop para un conjunto
   * de asientos activos. Siempre habrá un único OR (open raise) y, de
   * manera opcional, un jugador que hace call o 3bet a dicho OR. El resto
   * de asientos activos se marcan como fold. Para hacer el escenario más
   * creíble, el jugador que responde al OR se elige entre los asientos
   * posteriores (en orden numérico) al OR. Si la acción del segundo
   * jugador es call, existe la posibilidad de que un tercer asiento
   * posterior también pague.
   *
   * @param {number[]} active - array de índices de asientos activos
   * @returns {string[]} acciones para cada asiento (''|OR|call|3bet|fold)
   */
  function generateActions(active) {
    const actions = Array(10).fill('');
    if (active.length === 0) return actions;
    // Ordenar asientos activos por índice para aproximar el orden de juego.
    const seatsSorted = active.slice().sort((a, b) => a - b);
    // Elegir al azar el asiento que hace OR.
    const orSeat = seatsSorted[U.randInt(0, seatsSorted.length - 1)];
    actions[orSeat] = 'OR';
    // Calcular los asientos que actúan después del OR en orden circular.
    const idxOr = seatsSorted.indexOf(orSeat);
    // Asientos que actúan después del OR: sólo los de índice mayor (no se recorre el círculo).
    const afterSeats = seatsSorted.slice(idxOr + 1);
    if (afterSeats.length > 0) {
      // Elegir un asiento que responda al OR.
      const otherSeat = afterSeats[U.randInt(0, afterSeats.length - 1)];
      // Con mayor probabilidad ocurre un call; la 3bet es menos frecuente.
      const otherAction = Math.random() < 0.3 ? '3bet' : 'call';
      actions[otherSeat] = otherAction;
      // Si el otro jugador hace call, puede haber un call adicional detrás de él.
      const idxOther = afterSeats.indexOf(otherSeat);
      const afterOther = afterSeats.slice(idxOther + 1);
      if (otherAction === 'call' && afterOther.length > 0 && Math.random() < 0.5) {
        const callSeat = afterOther[U.randInt(0, afterOther.length - 1)];
        actions[callSeat] = 'call';
      }
    }
    // El resto de asientos activos que no tienen acción asignada se marcan como fold.
    active.forEach(s => {
      if (!actions[s]) actions[s] = 'fold';
    });
    return actions;
  }

  /**
   * Genera las acciones preflop en el modo OR/IP/OOP usando asientos
   * concretos para OR y el segundo jugador (call o 3bet). Asegura que
   * las acciones son coherentes: nadie paga antes del OR y, si el
   * segundo jugador hace call, puede haber un call adicional detrás.
   *
   * @param {number[]} active - array de índices de asientos activos
   * @param {number} orSeat - asiento que realiza la subida inicial
   * @param {number} otherSeat - asiento que responde (call o 3bet)
   * @param {string} otherAction - 'call' o '3bet'
   * @returns {string[]} acciones para cada asiento
   */
  function generateActionsForOrIp(active, orSeat, otherSeat, otherAction) {
    const actions = Array(10).fill('');
    if (active.length === 0) return actions;
    actions[orSeat] = 'OR';
    actions[otherSeat] = (otherAction === '3bet' ? '3bet' : 'call');
    // Ordenar asientos activos para determinar quién actúa después del otroSeat.
    const seatsSorted = active.slice().sort((a, b) => a - b);
    const idxOr = seatsSorted.indexOf(orSeat);
    const idxOther = seatsSorted.indexOf(otherSeat);
    // Construir la lista de asientos que actúan después de otherSeat (sólo índices mayores).
    let afterOther = [];
    if (idxOther >= 0) {
      afterOther = seatsSorted.slice(idxOther + 1);
    }
    // En este modo se evita el call adicional tras una 3bet por claridad. Sólo
    // se permite un call adicional si el otro jugador hace call y existe un
    // asiento posterior a él.
    if (otherAction !== '3bet' && afterOther.length > 0 && Math.random() < 0.5) {
      const callSeat = afterOther[U.randInt(0, afterOther.length - 1)];
      if (!actions[callSeat]) actions[callSeat] = 'call';
    }
    // Resto de activos: fold
    active.forEach(s => {
      if (!actions[s]) actions[s] = 'fold';
    });
    return actions;
  }

  // ----- Mapeos de nomenclaturas -----
  // Posiciones intermedias para número de jugadores (B: LJ/HJ; A: MP)
  const POS_B = {
    2: [],
    3: [],
    4: ["UTG"],
    5: ["UTG", "CO"],
    6: ["UTG", "HJ", "CO"],
    7: ["UTG", "LJ", "HJ", "CO"],
    8: ["UTG", "UTG+1", "LJ", "HJ", "CO"],
    9: ["UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO"],
    10: ["UTG", "UTG+1", "UTG+2", "UTG+3", "LJ", "HJ", "CO"]
  };
  const POS_A = {
    2: [],
    3: [],
    4: ["UTG"],
    5: ["UTG", "CO"],
    6: ["UTG", "MP", "CO"],
    7: ["UTG", "MP", "MP+1", "CO"],
    8: ["UTG", "UTG+1", "MP", "MP+1", "CO"],
    9: ["UTG", "UTG+1", "UTG+2", "MP", "MP+1", "CO"],
    10: ["UTG", "UTG+1", "UTG+2", "UTG+3", "MP", "MP+1", "CO"]
  };
  // Orden canónico de todas las posiciones posibles (para mostrar siempre todas)
  const ORDER_A = ["UTG", "UTG+1", "UTG+2", "UTG+3", "MP", "MP+1", "CO", "BTN", "SB", "BB"];
  const ORDER_B = ["UTG", "UTG+1", "UTG+2", "UTG+3", "LJ", "HJ", "CO", "BTN", "SB", "BB"];

  // Devuelve el orden canónico correspondiente a la nomenclatura actual
  const canonOrderList = (set) => (set === 'A' ? ORDER_A.slice() : ORDER_B.slice());

  // Ordenar un conjunto de etiquetas según la lista canónica
  const canonOrder = (labels, set) => {
    const order = canonOrderList(set);
    return labels.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
  };

  // Calcular las etiquetas de cada asiento activo. Devuelve un array de 10 strings.
  function computeLabels(active, btn, setKey) {
    const labels = Array(10).fill('');
    const seats = active.slice();
    const n = seats.length;
    if (n < 2) return labels;
    const iBTN = seats.indexOf(btn);
    // Posiciones de las ciegas
    const sb = seats[(iBTN + 1) % n];
    const bb = seats[(iBTN + 2) % n];
    if (n === 2) {
      labels[sb] = "SB";
      labels[bb] = "BB";
      return labels;
    }
    // Etiquetas para BTN, SB y BB
    labels[btn] = "BTN";
    labels[sb] = "SB";
    labels[bb] = "BB";
    // Etiquetas intermedias (posiciones entre BB y BTN, excluyendo)
    const between = [];
    let i = seats.indexOf(bb);
    do {
      i = (i + 1) % n;
      if (seats[i] !== btn) between.push(seats[i]);
    } while (seats[i] !== btn);
    // Mapa según número de jugadores y set de nomenclatura
    const map = (setKey === 'A' ? POS_A : POS_B)[n] || [];
    between.forEach((s, k) => {
      labels[s] = map[k] || ("EP" + (k + 1));
    });
    return labels;
  }

  // ----- Funciones de renderizado -----

  /**
   * Generar los botones de posición. Se muestran todas las posiciones definidas en el orden canónico.
   * Dependiendo del modo de juego y de las posiciones activas, se aplican clases y manejadores.
   * @param {Set<string>} activeLabels - Conjunto de etiquetas actualmente asignadas a asientos activos.
   */
  function renderPosButtons(activeLabels) {
  // Lista completa, siempre
  const list = canonOrderList(state.config.namingSet);

  dom.posButtons.innerHTML = '';
  list.forEach(label => {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.label = label;

    // Activo si está en el set de etiquetas activas
    const isActive = activeLabels.has(label);

    b.disabled = !isActive;
    if (!isActive) {
      b.classList.add('disabled');
    }

    dom.posButtons.appendChild(b);
  });
}




  /**
   * Establecer los manejadores en los botones de posición para responder en modo Asiento → Posición.
   * Recibe la etiqueta correcta y asigna onclick a cada botón.
   * @param {string} correctLabel
   */
  function enablePosAnswer(correctLabel) {
    dom.posButtons.querySelectorAll('button').forEach(b => {
      // Ignorar botones verdaderamente deshabilitados (sin etiqueta válida)
      if (b.classList.contains('disabled')) return;
      b.disabled = false;
      b.onclick = () => finishAnswer(b.dataset.label === correctLabel);
    });
  }

  /**
   * Marcar un único botón de posición como activo (modo Pos → Asiento).
   * Aplica la clase 'asking' al botón correspondiente y deshabilita el resto.
   * @param {string} targetLabel
   */
  // app.js — sustituye completamente highlightPosButton()
// app.js — reemplaza COMPLETO highlightPosButton()
function highlightPosButton(targetLabel) {
  const isHU = (state.config.players === 2);
  // Recorre todos los botones de posición y aplica estilos y manejadores.
  dom.posButtons.querySelectorAll('button').forEach(b => {
    const isTarget = (b.dataset.label === targetLabel);
    // En heads‑up ambos botones permanecen habilitados pero sólo el objetivo se resalta.
    if (isHU) {
      b.disabled = false;
      b.classList.remove('disabled');
      b.classList.toggle('asking', isTarget);
      // Al pulsar el botón, validar según sea el correcto o no.
      b.onclick = () => finishAnswer(isTarget);
    } else {
      // Con más de dos jugadores se mantiene únicamente habilitado el botón correcto.
      b.disabled = !isTarget;
      b.classList.toggle('asking', isTarget);
      if (isTarget) {
        b.classList.remove('disabled');
        b.onclick = () => finishAnswer(true);
      } else {
        b.classList.add('disabled');
        // Pulsar un botón incorrecto se considera respuesta errónea.
        b.onclick = () => finishAnswer(false);
      }
    }
  });
}


  /**
   * Establecer todos los botones de posición en modo oscuro (inactivos). Utilizado en modo OR/IP/OOP.
   */
  function disableAllPosButtons() {
    dom.posButtons.querySelectorAll('button').forEach(b => {
      b.disabled = true;
      b.classList.add('disabled');
      b.classList.remove('asking');
    });
  }

  /**
   * Renderiza la mesa y los asientos. Crea los elementos .seat, aplica clases según estén activos
   * o no y posiciona los chips de roles y apuestas.
   */
  function renderTable() {
    // Eliminar asientos anteriores
    dom.table.querySelectorAll('.seat').forEach(el => el.remove());
    // Limpiar chips
    dom.chips.innerHTML = '';
    // Crear 10 asientos
    for (let i = 0; i < 10; i++) {
      const pos = U.seatPos(i, 10, 42); // radio 42 para alinear con el anillo
      const seat = document.createElement('div');
      seat.className = 'seat';
      if (!state.activeSeats[i]) seat.classList.add('unavailable');
      seat.style.left = pos.x + '%';
      seat.style.top = pos.y + '%';
      seat.style.transform = 'translate(-50%, -50%)';
      seat.dataset.seat = String(i);
      // Etiqueta de posición
      const tag = document.createElement('div');
      tag.className = 'tag';
      // Mostrar la etiqueta sólo si está habilitado showLabels y no se ocultan etiquetas
      const shouldShow = state.config.showLabels && state.labels[i] && !state.hideLabels;
      tag.textContent = shouldShow ? state.labels[i] : '';
      if (!shouldShow) tag.classList.add('hidden');
      seat.appendChild(tag);
      // Acción (call/fold/3bet/OR) mostrada dentro del asiento
      const actionLabel = state.actions[i] || '';
      if (actionLabel) {
        const actEl = document.createElement('div');
        actEl.className = 'action';
        // Añadir una clase específica según el tipo de acción para estilos distintos.
        // Los nombres con dígitos se sanitizan para CSS (e.g. 3bet -> threebet).
        let cls = actionLabel.toLowerCase();
        if (cls === '3bet') cls = 'threebet';
        actEl.classList.add(cls);
        actEl.textContent = actionLabel.toUpperCase();
        seat.appendChild(actEl);
      }
      // Marcar asiento en función del modo de juego:
      // En seatToPos y seatIp se resalta el asiento objetivo como referencia al usuario.
      if (state.question && (state.question.type === 'seatToPos' || state.question.type === 'seatIp') && state.question.meta && state.question.meta.targetSeat === i) {
        seat.classList.add('asking');
      }
      // Marcar el asiento que realiza el OR solo si no estamos en el modo IP→Asiento. En
      // ese modo el usuario no debe recibir pistas visuales del asiento que realiza el OR.
     // Marcar el asiento que realiza el OR solo fuera de los modos IP/OOP
if (
  state.question &&
  state.question.orSeat === i &&
  state.question.type !== 'ipToSeat' &&
  state.question.type !== 'seatIp'
) {
  seat.classList.add('or-seat');
}


      // Manejar click en asientos
      seat.addEventListener('click', () => onSeatClick(i));
      dom.table.appendChild(seat);
    }
    // Colocar chips de roles (dealer, SB, BB)
    placeRoleChips();
    // No se colocan fichas adicionales; las acciones se muestran dentro de los asientos
  }

  /**
   * Coloca las fichas de roles (dealer, SB, BB). El dealer se muestra delante del asiento (hacia dentro) con
   * color azul; SB y BB se colocan también hacia dentro. En heads-up sólo hay dealer (que actúa de SB) y BB.
   */
 // Reemplaza COMPLETO placeRoleChips() por esto
function placeRoleChips() {
  const active = [];
  for (let i = 0; i < 10; i++) if (state.activeSeats[i]) active.push(i);
  if (active.length === 0) return;

  const btn = state.btnSeat;
  const n = active.length;

  if (n === 2) {
    // Heads-up: SB = botón, y el otro asiento es BB. No mostramos ficha de dealer.
    const sb = btn;
    const bb = active.find(s => s !== btn);

    // SB
    placeChip(sb, 14, 'in', 'sb');

    // BB en dos capas para visibilidad
    placeChip(bb, 16, 'in', 'bb-bottom');
    placeChip(bb, 18, 'in', 'bb-top');
    return;
  }

  // 3+ jugadores: Dealer + SB + BB
  placeChip(btn, 12, 'in', 'dealer');
  const sb = active[(active.indexOf(btn) + 1) % n];
  const bb = active[(active.indexOf(btn) + 2) % n];
  placeChip(sb, 14, 'in', 'sb');
  placeChip(bb, 16, 'in', 'bb-bottom');
  placeChip(bb, 18, 'in', 'bb-top');
}


  /**
   * Posiciona una ficha alrededor de un asiento.
   * @param {number} seatIdx - índice del asiento (0-9)
   * @param {number} dist - distancia en porcentaje desde el centro del asiento
   * @param {'in'|'out'} toward - dirección (in: hacia el centro de la mesa; out: hacia fuera)
   * @param {string} kind - tipo de ficha ('dealer', 'sb', 'bb', 'bet', 'fold')
   */
  function placeChip(seatIdx, dist, toward, kind) {
    const p = U.seatPos(seatIdx, 10, 42);
    // Vector desde el centro de la mesa al asiento
    let nx = p.x - 50;
    let ny = p.y - 50;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    const dir = (toward === 'in') ? -1 : 1;
    const pos = {
      x: p.x + nx * dist * dir,
      y: p.y + ny * dist * dir
    };
    const chip = document.createElement('div');
    chip.className = `chip ${kind}`;
    chip.style.left = pos.x + '%';
    chip.style.top = pos.y + '%';
    dom.chips.appendChild(chip);
  }

  /**
   * Genera y coloca chips de acciones (bets y folds) para el modo OR/IP/OOP.
   * OR y el otro jugador muestran fichas de apuesta; el resto de jugadores activos muestran ficha de fold.
   */
  function renderActionChips() {
    // Mostrar fichas de acción únicamente en los modos que involucran IP/OOP
    if (!state.question) return;
    const type = state.question.type;
    if (type !== 'orIp' && type !== 'seatIp' && type !== 'ipToSeat') return;
    const { orSeat, otherSeat, meta } = state.question;
    const otherAction = meta.otherAction; // 'call' o '3bet'
    // OR siempre apuesta (una ficha)
    placeChip(orSeat, 5, 'in', 'bet');
    // Fichas según la acción del otro jugador
    if (otherAction === '3bet') {
      placeChip(otherSeat, 5, 'in', 'bet');
      placeChip(otherSeat, 6.5, 'in', 'bet');
    } else {
      // call
      placeChip(otherSeat, 5, 'in', 'bet');
    }
    // El resto de activos (excepto OR y otro) muestran fold
    const active = [];
    for (let i = 0; i < 10; i++) if (state.activeSeats[i]) active.push(i);
    active.forEach(s => {
      if (s === orSeat || s === otherSeat) return;
      placeChip(s, 5, 'in', 'fold');
    });
  }

  // ----- Lógica de preguntas y respuestas -----

  /**
   * Genera una nueva ronda: selecciona asientos activos y distribuye el botón, calcula etiquetas,
   * define la pregunta según el modo actual y actualiza la interfaz.
   */
  function nextRound() {
    // Antes de comenzar una nueva ronda, eliminar cualquier estilo de resaltado aplicado a
    // los botones IP/OOP. Esto asegura que ningún botón quede iluminado por la ronda
    // anterior cuando cambie el modo o la pregunta. Se elimina tanto la clase
    // 'asking' como los estilos en línea que pudieran haberse aplicado.
    if (dom.btnIP && dom.btnOOP) {
      dom.btnIP.classList.remove('asking');
      dom.btnOOP.classList.remove('asking');
      dom.btnIP.style.borderColor = '';
      dom.btnIP.style.boxShadow = '';
      dom.btnOOP.style.borderColor = '';
      dom.btnOOP.style.boxShadow = '';
    }
    // Elegir asientos activos al azar
    randomizeActiveSeats();
    // Calcular etiquetas de posiciones en función de los asientos activos y la nomenclatura
    const active = [];
    for (let i = 0; i < 10; i++) if (state.activeSeats[i]) active.push(i);
    state.labels = computeLabels(active, state.btnSeat, state.config.namingSet);
    // Conjunto de etiquetas activas (para habilitar los botones de posición)
    const activeLabels = new Set(state.labels.filter(Boolean));
    // Preparar pregunta
    const q = { type: state.config.mode, meta: {} };
    // Ocultar etiquetas según modo
    state.hideLabels = false;
    // Generar un escenario de acciones preflop por defecto. Estas acciones se
    // muestran dentro de los asientos y son utilizadas para los modos IP/OOP.
    state.actions = generateActions(active);
    // Modo Posición → Asiento
    if (state.config.mode === 'posToSeat') {
      // Elegir una etiqueta válida al azar
      const labs = Array.from(activeLabels);
      const pos = labs[U.randInt(0, labs.length - 1)];
      const target = state.labels.findIndex(l => l === pos);
      q.meta.posLabel = pos;
      q.meta.targetSeat = target;
      // No marcar asiento con clase asking (no pistas)
      // Ocultar etiquetas para evitar pistas
      state.hideLabels = true;
      // Renderizar mesa y botonera antes de aplicar highlight
      renderPosButtons(activeLabels);
      // Resaltar sólo el botón de la posición que se pregunta
      highlightPosButton(pos);
      // Formatear la pregunta
      setQuestion(`¿Asiento <strong>${pos}</strong>?`);
    }
    // Modo Asiento → Posición
    if (state.config.mode === 'seatToPos') {
      // Elegir un asiento activo aleatorio
      const target = active[U.randInt(0, active.length - 1)];
      const posLabel = state.labels[target];
      q.meta.targetSeat = target;
      q.meta.correctLabel = posLabel;
      // Ocultar etiquetas para evitar pistas
      state.hideLabels = true;
      // Renderizar mesa primero para poder marcar asiento
      renderPosButtons(activeLabels);
      // No resaltar posButtons; se habilitarán luego
      // Formatear la pregunta
      setQuestion(`¿Posición?`);
      // Establecer manejadores en los botones de posición
      enablePosAnswer(posLabel);
    }
    // Modo Asiento → IP/OOP: se señala un asiento y el usuario debe decir si está en posición (IP) o fuera de posición (OOP).
    if (state.config.mode === 'seatIp') {
      // Elegir OR y otro asiento para construir la acción; el OR y el segundo asiento deben ser distintos.
      const orSeat = active[U.randInt(0, active.length - 1)];
      let otherSeat = active[U.randInt(0, active.length - 1)];
      while (otherSeat === orSeat) {
        otherSeat = active[U.randInt(0, active.length - 1)];
      }
      // Decidir acción del otro jugador (call/3bet) con probabilidad 50%
      const otherAction = Math.random() < 0.5 ? 'call' : '3bet';
      // Guardar asientos en la pregunta para marcarlos (p.ej. orSeat en rojo)
      q.orSeat = orSeat;
      q.otherSeat = otherSeat;
      q.meta.otherAction = otherAction;
      // Construir las acciones basadas en estos asientos
      state.actions = generateActionsForOrIp(active, orSeat, otherSeat, otherAction);
      // Calcular orden postflop para determinar quién está en posición respecto al OR
      const order = U.postflopOrder(active, state.btnSeat);
      const ia = order.indexOf(orSeat);
      const ib = order.indexOf(otherSeat);
      const otherIsIP = ib > ia;
      // Elegir aleatoriamente si se pregunta por el OR o por el otro jugador
      const targetSeat = Math.random() < 0.5 ? orSeat : otherSeat;
      const isIP = (targetSeat === orSeat) ? !otherIsIP : otherIsIP;
      q.meta.targetSeat = targetSeat;
      q.meta.isIP = isIP;
      // Ocultar etiquetas para no dar pistas
      state.hideLabels = true;
      // Renderizar la botonera; los botones de posición no se usan aquí
      renderPosButtons(activeLabels);
      disableAllPosButtons();
      // Formatear la pregunta
      const seatLabel = state.labels[targetSeat] || '';
      setQuestion(`¿<strong>IP</strong> / <strong>OOP</strong>?`);
    }
    // Modo IP/OOP → Asiento: se pregunta quién está IP u OOP y el usuario debe pulsar el asiento correcto.
    if (state.config.mode === 'ipToSeat') {
      // Elegir asientos para OR y para la respuesta (call/3bet). Ambos deben ser distintos.
      const orSeat = active[U.randInt(0, active.length - 1)];
      let otherSeat = active[U.randInt(0, active.length - 1)];
      while (otherSeat === orSeat) {
        otherSeat = active[U.randInt(0, active.length - 1)];
      }
      // Decidir acción del otro jugador con probabilidad 50%: call o 3bet.
      const otherAction = Math.random() < 0.5 ? 'call' : '3bet';
      q.orSeat = orSeat;
      q.otherSeat = otherSeat;
      q.meta.otherAction = otherAction;
      // Construir las acciones preflop coherentes con estos asientos.
      state.actions = generateActionsForOrIp(active, orSeat, otherSeat, otherAction);
      // Calcular orden postflop para determinar quién está IP respecto al OR.
      const order = U.postflopOrder(active, state.btnSeat);
      const ia = order.indexOf(orSeat);
      const ib = order.indexOf(otherSeat);
      const otherIsIP = ib > ia;
      // Determinar al azar si se pregunta por el jugador IP o por el jugador OOP.
      const askWho = Math.random() < 0.5 ? 'IP' : 'OOP';
      q.meta.askWho = askWho;
      const correctSeat = (askWho === 'IP')
        ? (otherIsIP ? otherSeat : orSeat)
        : (otherIsIP ? orSeat : otherSeat);
      q.meta.correctSeat = correctSeat;
      // Ocultar etiquetas para no dar pistas.
      state.hideLabels = true;
      // Renderizar la botonera de posiciones (no se usa en este modo).
      renderPosButtons(activeLabels);
      disableAllPosButtons();
      // Resaltar visualmente el botón IP u OOP correspondiente usando la clase 'asking'.
      // Primero eliminamos cualquier estado previo y deshabilitamos ambos botones, ya que en este modo
      // se contesta seleccionando un asiento y no pulsando IP/OOP. También marcamos el contenedor
      // como deshabilitado para que adopte el estilo atenuado por defecto.
      if (dom.btnIP && dom.btnOOP) {
        // Eliminar resaltados anteriores
        dom.btnIP.classList.remove('asking');
        dom.btnOOP.classList.remove('asking');
        // Deshabilitar botones
        dom.btnIP.disabled = true;
        dom.btnOOP.disabled = true;
        // Añadir estado deshabilitado al contenedor
        dom.ipButtons.classList.add('disabled');
        // Establecer la clase 'asking' en el botón que corresponde a la pregunta (IP u OOP)
        if (askWho === 'IP') {
          dom.btnIP.classList.add('asking');
        } else {
          dom.btnOOP.classList.add('asking');
        }
      }
      // Actualizar el texto de la pregunta para indicar qué jugador hay que buscar y que el usuario pulse el asiento.
      setQuestion(`¿<strong>${askWho}</strong>?`);
    }
    // Guardar pregunta en estado
    state.question = q;
    // Reiniciar temporizador
    state.timeLeft = state.config.timerSec;
    // Rellenar mesa (esta función coloca asientos, roles y chips de acción según corresponda)
    renderTable();
    // Mostrar fichas de acción en modos IP/OOP
    if (state.config.mode === 'seatIp' || state.config.mode === 'ipToSeat') {
      renderActionChips();
    }
    // Siempre mostrar el anillo y actualizar su progreso inicial
    updateRing();

    // Mostrar u ocultar los botones IP/OOP según el modo de juego
    // IP/OOP siempre visibles; se deshabilitan fuera de seatIp
if (dom.ipButtons) {
  dom.ipButtons.style.display = 'grid'; // alineado con CSS
  const enable = (state.config.mode === 'seatIp');
  dom.btnIP.disabled = !enable;
  dom.btnOOP.disabled = !enable;
  dom.ipButtons.classList.toggle('disabled', !enable);
}

  }

  /**
   * Selecciona aleatoriamente `state.config.players` asientos para estar activos y determina la posición del botón.
   */
  function randomizeActiveSeats() {
    const n = state.config.players;
    // Barajar índices de 0 a 9 y tomar los primeros n
    const idxs = U.shuffle([...Array(10).keys()]);
    const chosen = new Set(idxs.slice(0, n));
    for (let i = 0; i < 10; i++) {
      state.activeSeats[i] = chosen.has(i);
    }
    // Elegir botón al azar entre los activos
    const actArr = [...chosen];
    state.btnSeat = actArr[U.randInt(0, actArr.length - 1)];
  }

  /**
   * Marca un asiento como el que se pregunta añadiendo la clase 'asking'. Sólo se usa para seatToPos y orIp.
   * @param {number} seatIdx
   */
  function markSeatAsking(seatIdx) {
    const el = dom.table.querySelector(`.seat[data-seat="${seatIdx}"]`);
    if (el) el.classList.add('asking');
  }

  /**
   * Establece el HTML de la pregunta.
   * @param {string} html
   */
  function setQuestion(html) {
    dom.question.innerHTML = html;
  }

  /**
   * Finaliza la respuesta del usuario. Si es correcta se pasa a la siguiente ronda; si no, muestra un error.
   * @param {boolean} ok
   */
  function finishAnswer(ok) {
    if (ok) {
      nextRound();
    } else {
      pulseError();
    }
  }

  /**
   * Resalta la mesa en rojo brevemente para indicar error.
   */
  function pulseError() {
    // Mostrar efecto de error en toda la interfaz durante un breve periodo.
    showError(600);
  }

  /**
   * Cambia el esquema de color a rojo para señalar un error o tiempo agotado.
   * Tras el retardo indicado se ejecuta el callback opcional y se restablecen
   * los colores originales.
   * @param {number} delay - milisegundos que dura el destello rojo
   * @param {Function} [after] - función a ejecutar una vez desaparece el destello
   */
  function showError(delay, after) {
    // Aplicar la clase en el body para que las variables CSS cambien a rojo
    document.body.classList.add('error-state');
    // Esperar el retardo y luego revertir el color
    setTimeout(() => {
      document.body.classList.remove('error-state');
      if (typeof after === 'function') after();
    }, delay);
  }

  /**
   * Muestra un destello rojo utilizando la capa de overlay. Esta capa
   * cubre la mesa y se desvanece automáticamente tras el retardo
   * especificado. Al finalizar, se ejecuta el callback proporcionado.
   * @param {number} delay - duración del destello en milisegundos
   * @param {Function} [after] - función a ejecutar al terminar
   */
  function showFlash(delay = 600, after){
  document.body.classList.add('error-state');
  setTimeout(() => {
    document.body.classList.remove('error-state');
    if (typeof after === 'function') after();
  }, delay);
}

  /**
   * Maneja el agotamiento del tiempo. En lugar de reiniciar el temporizador
   * silenciosamente, se tiñe toda la mesa de rojo durante un breve lapso
   * y, después, se inicia una nueva ronda. Esto evita confundir el
   * agotamiento del tiempo con un error de respuesta.
   */
  function onTimeExpired(){
  if (state.roundChanging) return;
  state.roundChanging = true;
  state.question = null;                // corta la pregunta
  showFlash(600, () => {                // mismo efecto que fallo
    nextRound();
    state.roundChanging = false;
  });
}


  /**
   * Manejador de clicks en asientos. Según el modo de juego, decide si la respuesta es correcta.
   * @param {number} s - índice de asiento pulsado
   */
  function onSeatClick(s) {
    if (!state.question) return;
    const q = state.question;
    if (q.type === 'posToSeat') {
      // Sólo responde en posToSeat: debe coincidir con el asiento objetivo y estar activo
      const ok = (s === q.meta.targetSeat) && state.activeSeats[s];
      finishAnswer(ok);
    } else if (q.type === 'seatToPos') {
      // En seatToPos, no debe pulsar asientos; cualquier click es error
      pulseError();
    } else if (q.type === 'seatIp') {
      // En el modo asiento→IP/OOP no se debe pulsar el asiento: usar los botones IP/OOP. Cualquier clic es error.
      pulseError();
    } else if (q.type === 'ipToSeat') {
      // Debe pulsar el asiento correcto (meta.correctSeat)
      const ok = (s === q.meta.correctSeat) && state.activeSeats[s];
      finishAnswer(ok);
    }
  }

  /**
   * Actualiza el anillo de progreso según el tiempo restante.
   */
  function updateRing() {
    if (!state.config.ringVisible) {
      dom.progressPath.style.strokeDasharray = state.ringLength;
      dom.progressPath.style.strokeDashoffset = state.ringLength;
      return;
    }
    const frac = Math.max(0, state.timeLeft) / state.config.timerSec;
    const offset = state.ringLength * (1 - frac);
    dom.progressPath.style.strokeDasharray = state.ringLength;
    dom.progressPath.style.strokeDashoffset = offset;
  }

  /**
   * Aplica la visibilidad del anillo según el checkbox.
   */
  // La visibilidad del anillo es permanente en esta versión, por lo que no se requiere función de alternancia.
  function applyRingVisibility() {
    // No hacer nada: el anillo siempre se muestra.
  }

  /**
   * Bucle de animación para el temporizador. Reduce el tiempo restante y actualiza el anillo.
   * Si se agota el tiempo, se marca error.
   */
  function tick(now) {
    if (!state.lastTick) state.lastTick = now;
    const dt = (now - state.lastTick) / 1000;
    state.lastTick = now;
    if (state.question) {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        // Si el tiempo se agota, lanzar el efecto de tiempo expirado.
        // No detener el bucle: se seguirá llamando a tick para la nueva ronda.
        onTimeExpired();
      } else {
        // Actualizar el anillo mientras aún queda tiempo.
        updateRing();
      }
    }
    // Continuar el bucle de animación siempre.
    requestAnimationFrame(tick);
  }

  /**
   * Asocia eventos a los controles de la interfaz.
   */
  function bindControls() {
    // Ajustar número de jugadores mediante flechas
    dom.playersDec.addEventListener('click', () => {
      if (state.config.players > 2) {
        state.config.players--;
        dom.playersVal.textContent = String(state.config.players);
        nextRound();
      }
    });
    dom.playersInc.addEventListener('click', () => {
      if (state.config.players < 10) {
        state.config.players++;
        dom.playersVal.textContent = String(state.config.players);
        nextRound();
      }
    });
    // Ajustar duración del temporizador mediante flechas (pasos de 0.5s)
    dom.timerDec.addEventListener('click', () => {
      const newVal = Math.max(0.5, state.config.timerSec - 0.5);
      if (newVal !== state.config.timerSec) {
        state.config.timerSec = +newVal.toFixed(1);
        dom.timerVal.textContent = `${state.config.timerSec}s`;
        state.timeLeft = state.config.timerSec;
        updateRing();
      }
    });
    dom.timerInc.addEventListener('click', () => {
      const newVal = Math.min(60, state.config.timerSec + 0.5);
      if (newVal !== state.config.timerSec) {
        state.config.timerSec = +newVal.toFixed(1);
        dom.timerVal.textContent = `${state.config.timerSec}s`;
        state.timeLeft = state.config.timerSec;
        updateRing();
      }
    });
    // Alternar distribución sesgada/uniforme
    dom.distToggle.addEventListener('click', () => {
      state.config.dist = (state.config.dist === 'uniform') ? 'biased' : 'uniform';
      // Actualizar apariencia del botón
      if (state.config.dist === 'biased') {
        dom.distToggle.classList.add('active');
      } else {
        dom.distToggle.classList.remove('active');
      }
    });
    // Alternar conjunto de nomenclaturas (A/B)
    dom.toggleNaming.addEventListener('click', () => {
      state.config.namingSet = (state.config.namingSet === 'A') ? 'B' : 'A';
      dom.namingLabel.textContent = state.config.namingSet;
      nextRound();
    });
    // Modo de juego
    const modes = [dom.modeSeatFromPos, dom.modePosFromSeat, dom.modeSeatIP, dom.modeIPSeat];
    // Añadir clase 'selected' a modo inicial
    modes.forEach(b => {
      if (b.classList.contains('active')) b.classList.add('selected');
    });
    modes.forEach(btn => btn.addEventListener('click', () => {
      // Quitar selección y estado activo de todos
      modes.forEach(b => {
        b.classList.remove('active');
        b.classList.remove('selected');
      });
      // Activar y seleccionar el botón pulsado
      btn.classList.add('active');
      btn.classList.add('selected');
      if (btn === dom.modeSeatFromPos) {
        state.config.mode = 'posToSeat';
      } else if (btn === dom.modePosFromSeat) {
        state.config.mode = 'seatToPos';
      } else if (btn === dom.modeSeatIP) {
        state.config.mode = 'seatIp';
      } else {
        state.config.mode = 'ipToSeat';
      }
      nextRound();
    }));
    // Respuestas para modo asiento → IP/OOP
    dom.btnIP.addEventListener('click', () => {
      // En seatIp, la pregunta guarda en meta.isIP si el asiento resaltado está en posición.
      if (state.question && state.question.type === 'seatIp') {
        finishAnswer(state.question.meta.isIP === true);
      }
    });
    dom.btnOOP.addEventListener('click', () => {
      if (state.question && state.question.type === 'seatIp') {
        finishAnswer(state.question.meta.isIP === false);
      }
    });
  }

  /**
   * Inicializa la aplicación: carga valores iniciales, calcula la longitud del anillo y ejecuta la primera ronda.
   */
  function init() {
    // Ajustar valores iniciales de controles
    dom.playersVal.textContent = String(state.config.players);
    dom.timerVal.textContent = `${state.config.timerSec}s`;
    // Establecer estado inicial del botón de distribución
    if (state.config.dist === 'biased') {
      dom.distToggle.classList.add('active');
    } else {
      dom.distToggle.classList.remove('active');
    }
    dom.namingLabel.textContent = state.config.namingSet;
    // Calcular la longitud del círculo del anillo para la animación
    state.ringLength = dom.progressPath.getTotalLength();
    dom.progressPath.style.strokeDasharray = state.ringLength;
    dom.progressPath.style.strokeDashoffset = state.ringLength;
    // Configurar también la estela de tiempo consumido. Este círculo
    // permanece completo (offset 0) y dibuja la estela en rojo oscuro.
    if (dom.trailPath) {
      dom.trailPath.style.strokeDasharray = state.ringLength;
      dom.trailPath.style.strokeDashoffset = 0;
    }
    // Asociar eventos
    bindControls();
    // Primera ronda
    nextRound();
    // Iniciar loop de temporizador
    requestAnimationFrame(tick);
  }

  return { init };
})();

// Iniciar la aplicación una vez cargado el DOM
window.addEventListener('DOMContentLoaded', () => {
  App.init();
});

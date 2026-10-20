// ---------------------------------------------------------------------------
// The Hook-Up restoration patch
//
// Runs once, in frame 1: after the game's ActionScript classes are defined and
// before frame 2 calls com.thup.dboy.Game.init(). Everything here replaces or
// wraps methods on the game's classes at runtime; the original code is untouched.
//
//  - Saving and loading go to a local SharedObject ("thehookup") with three slots
//    plus an autosave slot, instead of TheN.com's save.php / loadsavexml.php.
//  - A slot picker is drawn in Flash, so it works in Ruffle and in Flash Player.
//  - The game autosaves each morning when the player wakes up.
//  - Pending text-message appointments are saved too, so they no longer block saving.
//  - Debug logging no longer goes to the Alcon LocalConnection on every message,
//    and developer error popups only appear with the debug=1 FlashVar.
// ---------------------------------------------------------------------------

// Game.startLoadGame() sends players without a TheN.com user id (a number > 0)
// to /login.php.
_root.userOid = 1;

var HS = new Object();
_global.HookupSaves = HS;

HS.SO_NAME = "thehookup";
HS.SAVE_SLOTS = ["slot1", "slot2", "slot3"];
HS.LOAD_SLOTS = ["slot1", "slot2", "slot3", "auto"];
HS.LABELS = {slot1: "Slot 1", slot2: "Slot 2", slot3: "Slot 3", auto: "Autosave"};
HS.FONT = "Univers 55";
HS.TITLE_FONT = "SeriaSans-BoldItalicCaps";
HS.debug = (_root.debug == "1");
HS.pickerOpen = false;
HS.loadSlot = null;
HS.steps = null;

// ---- storage --------------------------------------------------------------

HS.getSO = function() {
	if (HS.so == undefined) {
		HS.so = SharedObject.getLocal(HS.SO_NAME, "/");
	}
	return HS.so;
};

HS.read = function(id) {
	var so = HS.getSO();
	if (so == null || so.data[id] == undefined || so.data[id].xml == undefined) {
		return null;
	}
	return so.data[id];
};

// returns true when the data reached storage
HS.write = function(id, rec) {
	var so = HS.getSO();
	if (so == null) {
		return false;
	}
	so.data[id] = rec;
	var res = so.flush(16384);
	return res != false;
};

// ---- formatting -----------------------------------------------------------

HS.cap = function(s) {
	return s.charAt(0).toUpperCase() + s.substr(1);
};

HS.gameTime = function(curtime) {
	var cd = new com.thup.dboy.ClockDate(curtime, null);
	return "Week " + (cd.getWeek() + 1) + ", " + HS.cap(cd.getDayText()) + " " + cd.getHour() + ":" + cd.getMinuteText() + cd.getAMPM();
};

HS.MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
HS.realTime = function(ms) {
	var d = new Date(ms);
	var h = d.getHours();
	var ampm = (h < 12) ? "am" : "pm";
	h = h % 12;
	if (h == 0) {
		h = 12;
	}
	var m = d.getMinutes();
	return HS.MONTHS[d.getMonth()] + " " + d.getDate() + ", " + h + ":" + (m < 10 ? "0" : "") + m + ampm;
};

// ---- small UI helpers -----------------------------------------------------

HS.box = function(mc, x, y, w, h, r, fill, alpha, lineW, lineColor) {
	if (lineW > 0) {
		mc.lineStyle(lineW, lineColor, 100);
	} else {
		mc.lineStyle();
	}
	mc.beginFill(fill, alpha);
	mc.moveTo(x + r, y);
	mc.lineTo(x + w - r, y);
	mc.curveTo(x + w, y, x + w, y + r);
	mc.lineTo(x + w, y + h - r);
	mc.curveTo(x + w, y + h, x + w - r, y + h);
	mc.lineTo(x + r, y + h);
	mc.curveTo(x, y + h, x, y + h - r);
	mc.lineTo(x, y + r);
	mc.curveTo(x, y, x + r, y);
	mc.endFill();
};

HS.label = function(mc, name, x, y, w, h, str, size, color, bold, align, font) {
	mc.createTextField(name, mc.getNextHighestDepth(), x, y, w, h);
	var t = mc[name];
	t.embedFonts = true;
	t.selectable = false;
	t.multiline = false;
	t.wordWrap = false;
	var f = new TextFormat();
	f.font = (font == undefined) ? HS.FONT : font;
	f.size = size;
	f.color = color;
	f.bold = bold;
	f.align = (align == undefined) ? "left" : align;
	t.setNewTextFormat(f);
	t.text = str;
	return t;
};

HS.nextFrame = function(fn) {
	var d = _root.getNextHighestDepth();
	var mc = _root.createEmptyMovieClip("__hsDefer" + d, d);
	mc.onEnterFrame = function() {
		this.removeMovieClip();
		fn();
	};
};

HS.toast = function(title, text) {
	new com.thup.dboy.AlertBox(title, text, true, 3);
};

// ---- slot picker ----------------------------------------------------------
// mode "save": pick one of the three slots for rec (replacing needs a second click)
// mode "load": pick a filled slot (including the autosave) to load

HS.C_PLUM = 0x6E1B47;
HS.C_PLUM_DARK = 0x4A1030;
HS.C_ROW = 0xF6EEF2;
HS.C_ROW_HOVER = 0xFBDDEC;
HS.C_ROW_LINE = 0xE3C9D6;
HS.C_TEXT = 0x3A0D26;
HS.C_MUTED = 0x7A6470;

HS.openPicker = function(mode, rec) {
	if (HS.pickerOpen) {
		return;
	}
	HS.pickerOpen = true;
	HS.pickerMode = mode;
	HS.pickerRec = rec;
	if (mode == "save") {
		HS.prevFreeze = com.thup.dboy.ThinkManager._freeze;
		com.thup.dboy.ThinkManager._freeze = true;
	}

	var ids = (mode == "save") ? HS.SAVE_SLOTS : HS.LOAD_SLOTS;
	var W = 430;
	var ROW_H = 54;
	var GAP = 8;
	var TOP = 58;
	var H = TOP + ids.length * (ROW_H + GAP) + 54;
	var X = Math.round((770 - W) / 2);
	var Y = Math.round((560 - H) / 2);

	var depth = _root.getNextHighestDepth();
	var ui = _root.createEmptyMovieClip("__hsPicker", depth);
	HS.ui = ui;

	// dim the game and swallow clicks behind the dialog
	var shade = ui.createEmptyMovieClip("shade", 1);
	HS.box(shade, 0, 0, 770, 560, 0, 0x000000, 55, 0);
	shade.onRelease = function() {
	};
	shade.useHandCursor = false;

	var panel = ui.createEmptyMovieClip("panel", 2);
	panel._x = X;
	panel._y = Y;
	HS.box(panel, 0, 0, W, H, 10, 0xFFFFFF, 100, 3, HS.C_PLUM);
	HS.box(panel, 2, 2, W - 4, 42, 8, HS.C_PLUM, 100, 0);
	panel.lineStyle();
	panel.beginFill(HS.C_PLUM, 100);
	panel.moveTo(2, 30);
	panel.lineTo(W - 2, 30);
	panel.lineTo(W - 2, 44);
	panel.lineTo(2, 44);
	panel.endFill();
	HS.label(panel, "title", 0, 9, W, 30, (mode == "save") ? "save game" : "load game", 20, 0xFFFFFF, false, "center", HS.TITLE_FONT);

	var i;
	for (i = 0; i < ids.length; i++) {
		HS.makeRow(panel, ids[i], 16, TOP + i * (ROW_H + GAP), W - 32, ROW_H);
	}

	var cancel = panel.createEmptyMovieClip("cancel", panel.getNextHighestDepth());
	cancel._x = W / 2 - 60;
	cancel._y = H - 44;
	HS.box(cancel, 0, 0, 120, 30, 6, 0x1E1E1E, 100, 0);
	HS.label(cancel, "t", 0, 6, 120, 20, "CANCEL", 12, 0xFFFFFF, true, "center");
	cancel.onRelease = function() {
		com.thup.dboy.SoundManager.genericClick();
		HS.closePicker();
	};

	HS.keyListener = new Object();
	HS.keyListener.onKeyDown = function() {
		if (Key.getCode() == Key.ESCAPE) {
			HS.closePicker();
		}
	};
	Key.addListener(HS.keyListener);
};

HS.makeRow = function(panel, id, x, y, w, h) {
	var row = panel.createEmptyMovieClip("row_" + id, panel.getNextHighestDepth());
	row._x = x;
	row._y = y;
	row.id = id;
	row.w = w;
	row.h = h;
	row.rec = HS.read(id);
	row.draw = function(hover) {
		this.clear();
		HS.box(this, 0, 0, this.w, this.h, 6, hover ? HS.C_ROW_HOVER : HS.C_ROW, 100, 1, HS.C_ROW_LINE);
	};
	row.draw(false);
	HS.label(row, "slot", 12, 7, 120, 20, HS.LABELS[id], 13, HS.C_PLUM, true);
	var detail;
	var when = "";
	if (row.rec == null) {
		detail = (HS.pickerMode == "save") ? "Empty - click to save here" : "Empty";
	} else {
		detail = row.rec.name + "  -  " + HS.gameTime(row.rec.curtime);
		when = "Saved " + HS.realTime(row.rec.savedAt);
	}
	row.detail = HS.label(row, "detail", 12, 27, w - 24, 20, detail, 12, (row.rec == null) ? HS.C_MUTED : HS.C_TEXT, false);
	HS.label(row, "when", w - 212, 8, 200, 18, when, 10, HS.C_MUTED, false, "right");

	var usable = (HS.pickerMode == "save") || (row.rec != null);
	if (!usable) {
		row._alpha = 55;
		return;
	}
	row.onRollOver = function() {
		this.draw(true);
		com.thup.dboy.SoundManager.playNavRollOver();
	};
	row.onRollOut = row.onDragOut = function() {
		this.draw(false);
	};
	row.onRelease = function() {
		com.thup.dboy.SoundManager.genericClick();
		HS.pickRow(this);
	};
};

HS.pickRow = function(row) {
	if (HS.pickerMode == "load") {
		var id = row.id;
		HS.closePicker();
		HS.beginLoad(id);
		return;
	}
	// save: replacing an existing save takes a second click on the same row
	if (row.rec != null && !row.armed) {
		var k;
		for (k in HS.ui.panel) {
			var other = HS.ui.panel[k];
			if (other.armed) {
				other.armed = false;
				other.detail.text = other.rec.name + "  -  " + HS.gameTime(other.rec.curtime);
				other.detail.textColor = HS.C_TEXT;
			}
		}
		row.armed = true;
		row.detail.text = "Click again to replace this save";
		row.detail.textColor = 0xB0124F;
		return;
	}
	var rec = HS.pickerRec;
	var slotId = row.id;
	HS.closePicker();
	if (HS.write(slotId, rec)) {
		HS.toast("Game saved", HS.LABELS[slotId] + ": " + HS.gameTime(rec.curtime));
	} else {
		new com.thup.dboy.Prompt("Couldn't save. Local storage is turned off or full for this game.", true);
	}
};

HS.closePicker = function() {
	if (!HS.pickerOpen) {
		return;
	}
	Key.removeListener(HS.keyListener);
	HS.ui.removeMovieClip();
	HS.ui = null;
	HS.pickerOpen = false;
	if (HS.pickerMode == "save") {
		com.thup.dboy.ThinkManager._freeze = HS.prevFreeze;
	}
	HS.pickerRec = null;
};

// ---- when saving is allowed ----------------------------------------------

HS.blockReason = function() {
	var gsm = com.thup.dboy.Game.gsm;
	var st = gsm.current.stateName;
	if (st == "intense") {
		return "You can't save during an intense conversation.";
	}
	if (st != "world walk" || com.thup.dboy.ThinkManager._freeze) {
		return "You can save while you're out walking around, not inside a place or during a conversation or scene.";
	}
	return null;
};

// ---- SaveManager ----------------------------------------------------------

var SM = com.thup.dboy.SaveManager.prototype;
SM.__origSave = SM.save;

// auto == true: autosave into the "auto" slot, silently skipped when not allowed
SM.save = function(auto) {
	if (this.__busy || HS.pickerOpen) {
		return;
	}
	var reason = HS.blockReason();
	if (reason != null) {
		if (!auto) {
			new com.thup.dboy.Prompt(reason, true);
		}
		return;
	}
	this.__auto = (auto == true);
	// The original refuses while a text-message appointment is pending, because its
	// save format can't store one. Those are saved separately below, so hide them
	// from the original check and put them back afterwards.
	var items = com.thup.dboy.Game.player.appointmentManager._items;
	var phones = new Array();
	var rest = new Array();
	var i;
	for (i = 0; i < items.length; i++) {
		if (items[i].isPhone) {
			phones.push(items[i]);
		} else {
			rest.push(items[i]);
		}
	}
	com.thup.dboy.Game.player.appointmentManager._items = rest;
	this.__busy = true;
	this.__origSave();
	com.thup.dboy.Game.player.appointmentManager._items = items;
	this.__phones = phones;
};

// The original builds the nugget string 10 entries per frame; do it in one go.
SM.think = function() {
	if (this._isloading) {
		this.loadThink();
		return;
	}
	var m = this._mem;
	var s = "";
	var i;
	for (i = this._curIdx; i < m.length; i++) {
		s += (m[i] == 1) ? "1" : "0";
	}
	this._curString += s;
	this._curIdx = m.length;
	com.thup.dboy.ThinkManager.removeThinker(this);
	this.saveComplete();
};

// Replaces getURL("save.php", "_self", "POST"), which navigated away from the game.
SM.saveComplete = function() {
	var x = this.saveXML;
	var mem = x.createElement("MEMORY");
	mem.appendChild(x.createTextNode(this._curString));
	this.topnode.appendChild(mem);

	var phoneNode = x.createElement("PHONEAPPTS");
	if (this.__phones == undefined) {
		this.__phones = new Array();
	}
	var i;
	for (i = 0; i < this.__phones.length; i++) {
		var a = this.__phones[i];
		if (a._convStep.__csid == undefined) {
			HS.indexSteps();
		}
		if (a._convStep.__csid != undefined) {
			var n = x.createElement("PHONEAPPT");
			n.attributes.DATE = a.date;
			n.attributes.TIME = a.time;
			n.attributes.DURATION = a.duration;
			n.attributes.CS_ID = a._convStep.__csid;
			phoneNode.appendChild(n);
		}
	}
	this.topnode.appendChild(phoneNode);
	x.appendChild(this.topnode);

	var rec = new Object();
	rec.xml = x.toString();
	rec.name = com.thup.dboy.Game.player.name;
	rec.curtime = com.thup.dboy.Game.gameClock.curdate.curtime;
	rec.savedAt = new Date().getTime();
	this.__busy = false;
	this.__phones = null;
	if (this.__auto) {
		if (HS.write("auto", rec)) {
			HS.toast("Autosaved", "Good morning! Your game was saved.");
		}
	} else {
		HS.openPicker("save", rec);
	}
};

// Replaces XML.load("loadsavexml.php?oid=..."). Deferred a frame because
// GameStateManager.setState() hasn't made the load state current yet.
SM.startLoad = function(aOid) {
	var me = this;
	var rec = HS.read(HS.loadSlot);
	this.saveXML = new XML();
	this.saveXML.ignoreWhite = true;
	HS.nextFrame(function() {
		if (rec == null) {
			com.thup.dboy.Game.gsm.current.loadFailed();
			return;
		}
		me.saveXML.parseXML(rec.xml);
		if (me.saveXML.status != 0 || me.saveXML.firstChild.nodeName != "SAVEGAME") {
			com.thup.dboy.Game.gsm.current.loadFailed();
			return;
		}
		me.parseLoad();
		HS.restorePhones(me.saveXML.firstChild);
	});
};

HS.indexSteps = function() {
	var k;
	for (k in HS.steps) {
		if (k.substr(0, 3) == "id_") {
			HS.steps[k].__csid = k.substr(3);
		}
	}
};

HS.restorePhones = function(top) {
	var i;
	var j;
	for (i = 0; i < top.childNodes.length; i++) {
		if (top.childNodes[i].nodeName == "PHONEAPPTS") {
			var list = top.childNodes[i].childNodes;
			for (j = 0; j < list.length; j++) {
				var at = list[j].attributes;
				var step = HS.steps["id_" + at.CS_ID];
				if (step != undefined) {
					com.thup.dboy.Game.player.appointmentManager.addAppointment(new com.thup.dboy.AppointmentPhone(parseInt(at.DATE), parseInt(at.TIME), parseInt(at.DURATION), step));
				}
			}
		}
	}
};

// ---- loading from the title screen ---------------------------------------

var G = com.thup.dboy.Game;
G.__origStartLoadGame = G.startLoadGame;
G.startLoadGame = function() {
	HS.openPicker("load", null);
};
HS.beginLoad = function(id) {
	HS.loadSlot = id;
	com.thup.dboy.Game.__origStartLoadGame();
};

// The content loader keeps conversation steps on an instance that the game drops
// once loading finishes; keep a reference so phone appointments can be saved.
G.__origInit = G.init;
G.init = function() {
	com.thup.dboy.Game.__origInit();
	HS.steps = com.thup.dboy.Game.contentManager._conversationSteps;
};

// ---- autosave each morning ------------------------------------------------

var P = com.thup.dboy.Player.prototype;
P.__origAfterWakeUp = P.afterWakeUp;
P.afterWakeUp = function() {
	this.__origAfterWakeUp();
	HS.requestAutosave();
};

// waits (up to ~30s) until the morning scene settles into normal walking around
HS.requestAutosave = function() {
	if (HS.autoWaiter != undefined) {
		HS.autoWaiter.removeMovieClip();
	}
	var d = _root.getNextHighestDepth();
	var mc = _root.createEmptyMovieClip("__hsAuto" + d, d);
	HS.autoWaiter = mc;
	mc.frames = 0;
	mc.onEnterFrame = function() {
		this.frames++;
		var sm = com.thup.dboy.Game.saveManager;
		if (!HS.pickerOpen && !sm.__busy && HS.blockReason() == null && this.frames > 16) {
			this.removeMovieClip();
			HS.autoWaiter = undefined;
			sm.save(true);
		} else if (this.frames > 16 * 30) {
			this.removeMovieClip();
			HS.autoWaiter = undefined;
		}
	};
};

// ---- logging ---------------------------------------------------------------
// The original sends every message to the Alcon debugger over LocalConnection,
// and shows a popup for anything at ERROR level. Keep that behind debug=1.

net.hiddenresource.util.Debug.trace = function() {
};
com.thup.dboy.DebugHandler.msg = function(aTxt, aLevel, aObject) {
	if (aLevel == null) {
		aLevel = 1;
	}
	if (HS.debug) {
		trace("[hookup " + aLevel + "] " + aTxt);
		if (aLevel >= 3) {
			new com.thup.dboy.Prompt("<b><font color=\"#FF0000\">ERROR:</font>  " + aTxt + "</b>", true);
		}
	} else if (aLevel >= 3) {
		trace("[hookup error] " + aTxt);
	}
};

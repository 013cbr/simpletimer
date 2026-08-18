// ISO 8601 week number (week starts Monday, week 1 contains the first Thursday).
function isoWeekNumber(date) {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function loadJiraSubdomain() {
	const stored = localStorage.getItem('simpletimer.jiraSubdomain');
	if (stored !== null) return stored;

	// one-time migration from the old full-URL key
	const oldUrl = localStorage.getItem('simpletimer.jiraBaseUrl');
	if (oldUrl) {
		const m = oldUrl.match(/^https?:\/\/([^./]+)\.atlassian\.net\/browse\/?$/i);
		localStorage.removeItem('simpletimer.jiraBaseUrl');
		if (m) {
			localStorage.setItem('simpletimer.jiraSubdomain', m[1]);
			return m[1];
		}
	}
	return '';
}

// id must match the [data-theme=...] selectors in restyle.css. swatch mirrors
// that theme's --g1/--g2 ring gradient; light gets a hard split instead of a
// blend so it reads as "the light one" rather than as another orange.
const THEMES = [
	{ id: 'light',         label: 'Light',    meta: '#DC5934',
	  swatch: 'linear-gradient(135deg, #FFFFFF 0 50%, #F26C44 50% 100%)' },
	{ id: 'dark-sunset',   label: 'Sunset',   meta: '#131315',
	  swatch: 'linear-gradient(135deg, #FFC46B, #FF7A4D)' },
	{ id: 'dark-lagoon',   label: 'Lagoon',   meta: '#131315',
	  swatch: 'linear-gradient(135deg, #6FE8C4, #3FBEDC)' },
	{ id: 'dark-twilight', label: 'Twilight', meta: '#131315',
	  swatch: 'linear-gradient(135deg, #7FA6FF, #B08BFF)' },
	{ id: 'dark-glow',     label: 'Glow',     meta: '#131315',
	  swatch: 'linear-gradient(135deg, #B79BFF, #FF7ABF)' },
];

function loadTheme() {
	const stored = localStorage.getItem('simpletimer.theme');
	return THEMES.some(function (t) { return t.id === stored; }) ? stored : 'light';
}

function applyTheme(id) {
	document.documentElement.setAttribute('data-theme', id);

	// keep the mobile status bar in step with the theme
	const theme = THEMES.find(function (t) { return t.id === id; });
	const meta = document.querySelector('meta[name="theme-color"]');
	if (theme && meta) meta.setAttribute('content', theme.meta);
}

// What each adjust button makes of a value, as pure functions. The button and the
// hover preview both go through this table, so the preview can never disagree with
// what pressing actually does. All four snap to a quarter or an hour and drop the
// remainder — that is deliberate, but it means the change is not always the amount
// on the button, which is exactly why the preview is worth showing.
const ADJUST = {
	addHour:       function (s) { return s + 3600; },
	removeHour:    function (s) { return Math.max(s - 3600, 0); },
	addQuarter:    function (s) { return Math.floor((s + 900) / 900) * 900; },
	removeQuarter: function (s) { return Math.max(Math.ceil((s - 900) / 900) * 900, 0); },
};

// Task colours are stepped through the palette by task id rather than by hash or by
// list position. Ids are handed out in ascending order, so the spread is the same as
// by position, but a colour then survives a removal or a re-sort — with positions,
// deleting one task recoloured every task below it. STEP is coprime with
// TASK_COLOUR_COUNT, so all eight are used before the sequence wraps around.
const TASK_COLOUR_COUNT = 8;
const TASK_COLOUR_STEP = 3;

// Task ids must never be derived from the list length: after a removal the next
// id would collide with an existing one, and Vue uses id as the :key — two rows
// sharing a key means it can reuse the wrong DOM node.
let nextTaskId = 0;

function loadDayGoal() {
	const stored = parseFloat(localStorage.getItem('simpletimer.dayGoalHours'));
	return Number.isFinite(stored) && stored > 0 ? stored : 8;
}

// radius of the header goal ring, kept in sync with the <circle r> in index.html
const GOAL_RING_CIRCUMFERENCE = 2 * Math.PI * 17;

var app = new Vue({
	// app initial state
	data: {
		workDay: null,	//WeekDay.loadDay(),
		tasks: [],		//WeekDay.loadTasks(),
		newTask: '',
		beforeEditCache: null,
		editedTask: null,
		timedTask: null,
		viewMode: 'tasks',
		timerReadable: '',
		elapsedSeconds: 0,
		// separate from timedTask, which lingers for 320ms so the focus view can
		// slide out. elapsedSeconds lingers with it, so without this flag the day
		// total would count the finished session twice during that window.
		timerRunning: false,
		timerInterval: null,
		totalReadable: '',
		todaysDate: new Date().toLocaleDateString(),
		todaysWeek: isoWeekNumber(new Date()),
		startedAt: 0,
		jiraSubdomain: loadJiraSubdomain(),
		jiraSubdomainDraft: '',
		dayGoalHours: loadDayGoal(),
		dayGoalDraft: '',
		hoveredSegment: null,
		draggedTask: null,
		preview: null,
		themes: THEMES,
		theme: loadTheme(),
		themeDraft: '',
		settingsOpen: false
	},
	computed: {
		jiraBaseUrl: function () {
			return this.jiraSubdomain
				? 'https://' + this.jiraSubdomain + '.atlassian.net/browse/'
				: '';
		},
		jiraUrlPreview: function () {
			const sub = this.jiraSubdomainDraft.trim();
			return sub ? 'https://' + sub + '.atlassian.net/browse/' : '';
		},
		// proportional make-up of the day. The denominator is the goal, or the total
		// once that runs past it, so the bar never overflows its own track.
		dayBarSegments: function () {
			var scale = Math.max(this.totalSeconds, this.dayGoalSeconds) || 1;
			var self = this;
			return this.tasks.map(function (task) {
				return {
					id: task.id,
					title: task.title,
					colour: self.taskColour(task),
					width: task.secondsSpent / scale * 100 + '%',
					readable: self.formatSecondsAsReadable(task.secondsSpent, false)
				};
			});
		},
		// only shown once the day runs over the goal, marking where the goal sat
		dayBarGoalLeft: function () {
			if (this.totalSeconds <= this.dayGoalSeconds) return null;
			return (this.dayGoalSeconds / this.totalSeconds * 100) + '%';
		},
		dayBarRemaining: function () {
			var left = this.dayGoalSeconds - this.totalSeconds;
			return left > 0
				? this.formatSecondsAsReadable(left, false) + ' to go'
				: this.formatSecondsAsReadable(-left, false) + ' over';
		},
		themeLabel: function () {
			const draft = this.themeDraft;
			const theme = THEMES.find(function (t) { return t.id === draft; });
			return theme ? theme.label : '';
		},
		// live day total — includes the session currently running, so the goal
		// ring keeps creeping up instead of only jumping on stop
		totalSeconds: function () {
			var sum = 0;
			this.tasks.forEach(function (task) {
				sum += task.secondsSpent;
			});
			return sum + (this.timerRunning ? this.elapsedSeconds : 0);
		},
		dayGoalSeconds: function () {
			return this.dayGoalHours * 3600;
		},
		// 0..1 — first lap of the goal ring
		goalFraction: function () {
			if (this.dayGoalSeconds <= 0) return 0;
			return Math.min(this.totalSeconds / this.dayGoalSeconds, 1);
		},
		// 0..1 — anything beyond the goal, drawn as a second lap on top
		goalOvertimeFraction: function () {
			if (this.dayGoalSeconds <= 0) return 0;
			return Math.min(Math.max(this.totalSeconds / this.dayGoalSeconds - 1, 0), 1);
		},
		goalOffset: function () {
			return GOAL_RING_CIRCUMFERENCE * (1 - this.goalFraction);
		},
		goalOvertimeOffset: function () {
			return GOAL_RING_CIRCUMFERENCE * (1 - this.goalOvertimeFraction);
		},
		goalProgressReadable: function () {
			return this.formatSecondsAsHM(this.totalSeconds) + ' / ' + this.formatSecondsAsHM(this.dayGoalSeconds);
		},
		goalTitle: function () {
			var remaining = this.dayGoalSeconds - this.totalSeconds;
			return remaining > 0
				? this.formatSecondsAsReadable(remaining, false) + ' to go'
				: this.formatSecondsAsReadable(-remaining, false) + ' over';
		},
		// HH:MM (zero-padded) for the focus-screen readout
		focusReadable: function () {
			var h = Math.floor(this.elapsedSeconds / 3600);
			var m = Math.floor((this.elapsedSeconds % 3600) / 60);
			var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
			return pad(h) + ':' + pad(m);
		},
		// 0..60 — number of outer ticks lit, advances 1/sec, resets each minute
		secondsTickCount: function () {
			return this.elapsedSeconds % 60;
		},
		// stroke-dashoffset for minutes ring (r=88, full cycle = 1h)
		minutesOffset: function () {
			var c = 2 * Math.PI * 88;
			var fraction = (this.elapsedSeconds % 3600) / 3600;
			return c * (1 - fraction);
		},
		// stroke-dashoffset for the inner ring (r=78). This used to run on a 12-hour
		// cycle of the current session, which meant it barely moved: 2% after a
		// quarter of an hour, 6% after three quarters. It now carries the day
		// against the goal, which is the number worth watching while working.
		dayOffset: function () {
			var c = 2 * Math.PI * 78;
			var fraction = this.dayGoalSeconds > 0
				? Math.min(this.totalSeconds / this.dayGoalSeconds, 1)
				: 0;
			return c * (1 - fraction);
		},
		// the live day total, so the line above the ring agrees with the ring itself
		totalLiveReadable: function () {
			return this.formatSecondsAsReadable(this.totalSeconds, false);
		},
		// 60 evenly-spaced tick coordinates around the outer ring
		// (svg has rotate(-90deg), so angle 0 = 12 o'clock after rotation)
		tickPositions: function () {
			var ticks = [];
			var cx = 120, cy = 120, innerR = 104, outerR = 113;
			for (var n = 1; n <= 60; n++) {
				var rad = (n - 1) * 6 * Math.PI / 180;
				ticks.push({
					n: n,
					x1: cx + Math.cos(rad) * innerR,
					y1: cy + Math.sin(rad) * innerR,
					x2: cx + Math.cos(rad) * outerR,
					y2: cy + Math.sin(rad) * outerR
				});
			}
			return ticks;
		}
	},
	methods: {
		addTask: function () {
			var value = this.newTask && this.newTask.trim();
			if (!value) {
			  return;
			}
			this.tasks.push({
			  id: nextTaskId++,
			  title: value,
			  secondsSpent: 0,
			  timeSpentReadable: ''
			});
			this.newTask = '';
		},

		editTask: function (task) {
			this.beforeEditCache = task.title;
			this.editedTask = task;
		},

		doneEditing: function (task) {
			if (!this.editedTask) {
				return;
			}

			this.editedTask = null;
			task.title = task.title.trim();

			if (!task.title) {
				this.removeTask(task);
			}
		},

		cancelEditing: function (task) {
			this.editedTask = null;
			task.title = this.beforeEditCache;
		},

		removeTask: function (task) {
			var question = 'Remove task "' + task.title + '" ?';

			var confirmation = confirm(question);
			if (confirmation) {
				// stop the clock first — leaving timedTask pointing at a removed task
				// keeps the focus view ticking on something no list holds any more,
				// and its elapsed time would be written to that orphan
				if (task === this.timedTask) {
					this.stopTimer();
				}
				this.tasks.splice(this.tasks.indexOf(task), 1);
			}

			this.updateTotal();
		},

		adjust: function (task, key) {
			task.secondsSpent = ADJUST[key](task.secondsSpent);
			task.timeSpentReadable = this.formatSecondsAsReadable(task.secondsSpent);

			this.updateTotal();

			// keep the preview live, so holding the cursor still and clicking again
			// shows where the next press lands
			this.showPreview(task, key);
		},

		showPreview: function (task, key) {
			// same format as the total already in that cell, so hovering only adds the
			// arrow and the result — it does not restyle the number you were reading
			this.preview = {
				id: task.id,
				was: this.formatSecondsAsReadable(task.secondsSpent),
				becomes: this.formatSecondsAsReadable(ADJUST[key](task.secondsSpent))
			};
		},

		clearPreview: function () {
			this.preview = null;
		},

		// null unless this row is the one being hovered
		previewFor: function (task) {
			return this.preview && this.preview.id === task.id ? this.preview : null;
		},

		startTimer: function (task) {
			if (null == this.timedTask) {
				this.timedTask = task;
				this.timerRunning = true;
				this.viewMode = 'focus';
				this.startedAt = Date.now();
				this.elapsedSeconds = 0;
				this.timerReadable = '0h 0m';

				this.timerInterval = setInterval(this.updateTimer, 500);
			} else {
				console.warn('another task is already using the timer');
			}
		},

		updateTimer: function () {
			this.elapsedSeconds = Math.floor((Date.now() - this.startedAt) / 1000);
			this.timerReadable = this.formatSecondsAsReadable(this.elapsedSeconds, false);
		},

		formatSecondsAsReadable: function (secondsToFormat, includeSeconds) {
            if (includeSeconds === undefined) includeSeconds = true;

            var hours = 0, minutes = 0, seconds = 0;

            if (secondsToFormat >= 3600) {
                hours   = Math.floor(secondsToFormat / 3600);
            }
            if (secondsToFormat >= 60) {
                minutes = Math.floor((secondsToFormat - (hours * 3600)) / 60);
            }
            seconds = secondsToFormat - (hours * 3600) - (minutes * 60);

            return includeSeconds
                ? hours + 'h ' + minutes + 'm ' + seconds + 's'
                : hours + 'h ' + minutes + 'm';
		},

		// Reordering by hand: the row is moved as soon as the pointer enters another
		// one, so there is no drop indicator to maintain. Rows are keyed on task.id
		// and colours come from that id too, so a task keeps its own colour while it
		// travels instead of taking on the colour of the slot it lands in.
		startDrag: function (task) {
			this.draggedTask = task;
		},

		dragOver: function (task) {
			if (!this.draggedTask || task === this.draggedTask) {
				return;
			}
			var from = this.tasks.indexOf(this.draggedTask);
			var to = this.tasks.indexOf(task);
			if (from === -1 || to === -1) {
				return;
			}
			this.tasks.splice(to, 0, this.tasks.splice(from, 1)[0]);
		},

		endDrag: function () {
			this.draggedTask = null;
		},

		taskColour: function (task) {
			return 'var(--tc-' + ((task.id * TASK_COLOUR_STEP) % TASK_COLOUR_COUNT + 1) + ')';
		},

		// H:MM — compact form used by the day-goal readout
		formatSecondsAsHM: function (secondsToFormat) {
			var hours = Math.floor(secondsToFormat / 3600);
			var minutes = Math.floor((secondsToFormat % 3600) / 60);
			return hours + ':' + (minutes < 10 ? '0' + minutes : minutes);
		},

        formatAsJiraLink: function (title) {
            if (!this.jiraBaseUrl) {
                return title;
            }
            const pattern = /^([A-Z]{2,}-\d+)/;
            if (pattern.test(title)) {
                return title.replace(pattern, '<a href="'+this.jiraBaseUrl+'$1" target="_blank">$1</a>');
            }
            return title;
        },

        // applied live so the choice can actually be judged; saveSettings commits
        // it and closeSettings puts the previously stored theme back
        previewTheme: function (id) {
            this.themeDraft = id;
            applyTheme(id);
        },

        openSettings: function () {
            this.jiraSubdomainDraft = this.jiraSubdomain;
            this.dayGoalDraft = this.dayGoalHours;
            this.themeDraft = this.theme;
            this.settingsOpen = true;
        },

        saveSettings: function () {
            this.jiraSubdomain = this.jiraSubdomainDraft.trim();
            localStorage.setItem('simpletimer.jiraSubdomain', this.jiraSubdomain);

            // fall back to the default rather than letting a blank or bogus
            // value collapse the ring
            var goal = parseFloat(this.dayGoalDraft);
            if (!Number.isFinite(goal) || goal <= 0) goal = 8;
            this.dayGoalHours = Math.min(goal, 24);
            localStorage.setItem('simpletimer.dayGoalHours', this.dayGoalHours);

            this.theme = this.themeDraft;
            localStorage.setItem('simpletimer.theme', this.theme);

            this.settingsOpen = false;
        },

        closeSettings: function () {
            // drop any live preview that was not saved
            if (this.themeDraft !== this.theme) applyTheme(this.theme);
            this.settingsOpen = false;
        },

		stopTimer: function () {
			if (null != this.timedTask) {
				// stop counting immediately; timedTask and elapsedSeconds stay put
				// until the slide-out finishes
				this.timerRunning = false;

				var ranForSeconds = Math.floor((Date.now() - this.startedAt) / 1000);
				//console.log('task ran for ' + ranForSeconds + 's -- STOPPED');

				this.timedTask.secondsSpent += ranForSeconds;
				this.timedTask.timeSpentReadable = this.formatSecondsAsReadable(this.timedTask.secondsSpent);

				// clear the ticking interval and trigger the slide back
				clearInterval(this.timerInterval);
				this.viewMode = 'tasks';

				// keep the focus view rendered until the slide finishes,
				// so it slides out instead of vanishing
				var self = this;
				setTimeout(function () {
					self.timedTask = null;
					self.startedAt = 0;
					self.elapsedSeconds = 0;
					self.timerReadable = '';
				}, 320);
			}

			this.updateTotal();
		},

		updateTotal: function () {
			var totalSeconds = 0;
			this.tasks.forEach(function (item) {
				totalSeconds += item.secondsSpent;
			});

			this.totalReadable = this.formatSecondsAsReadable(totalSeconds);
		},

		print: function () {
			const d = new Date();
			let month = (d.getMonth() + 1).toString();
			month = month.length < 2 ? '0' + month : month;

			let day = d.getDate().toString();
			day = day.length < 2 ? '0' + day : day;

			navigator.clipboard.writeText(d.getFullYear() + '' + month + '' + day);
			window.print();
		},
	},	// end of methods

	directives: {
		'todo-focus': function (el, binding) {
			if (binding.value) {
				el.focus()
			}
		}
	}
});

// the inline boot script in index.html sets the attribute unvalidated,
// so re-apply the parsed value here
applyTheme(app.theme);

// mount
app.$mount('.timerapp')

/* for dev only:
app.newTask = 'ABC-123 lorem ipsum';
app.addTask();
app.startTimer(app.tasks[0]);
// */

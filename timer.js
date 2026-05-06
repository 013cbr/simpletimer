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
		timerInterval: null,
		totalReadable: '',
		todaysDate: new Date().toLocaleDateString(),
		todaysWeek: isoWeekNumber(new Date()),
		startedAt: 0,
		jiraSubdomain: loadJiraSubdomain(),
		jiraSubdomainDraft: '',
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
		// stroke-dashoffset for hours ring (r=78, full cycle = 12h)
		hoursOffset: function () {
			var c = 2 * Math.PI * 78;
			var fraction = (this.elapsedSeconds % 43200) / 43200;
			return c * (1 - fraction);
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
			var key = this.tasks.length;
			this.tasks.push({
			  id: key,
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
				this.tasks.splice(this.tasks.indexOf(task), 1);
			}

			this.updateTotal();
		},

		addHour: function (task) {
			task.secondsSpent += 3600;
			task.timeSpentReadable = this.formatSecondsAsReadable(task.secondsSpent);

			this.updateTotal();
		},

		// round up to the nearest 15 minutes
		addQuarter: function (task) {
			task.secondsSpent += 900;
			task.secondsSpent = Math.floor(task.secondsSpent / 900) * 900;

			task.timeSpentReadable = this.formatSecondsAsReadable(task.secondsSpent);

			this.updateTotal();
		},

		removeHour: function (task) {
			task.secondsSpent -= 3600;

            if (task.secondsSpent < 0) {
				task.secondsSpent = 0;
			}

			task.timeSpentReadable = this.formatSecondsAsReadable(task.secondsSpent);

			this.updateTotal();
		},

		// round down to the nearest 15 minutes
		removeQuarter: function (task) {
			task.secondsSpent -= 900;
			task.secondsSpent = Math.ceil(task.secondsSpent / 900) * 900;

            if (task.secondsSpent < 0) {
				task.secondsSpent = 0;
			}

			task.timeSpentReadable = this.formatSecondsAsReadable(task.secondsSpent);

			this.updateTotal();
		},

		startTimer: function (task) {
			if (null == this.timedTask) {
				this.timedTask = task;
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

        openSettings: function () {
            this.jiraSubdomainDraft = this.jiraSubdomain;
            this.settingsOpen = true;
        },

        saveSettings: function () {
            this.jiraSubdomain = this.jiraSubdomainDraft.trim();
            localStorage.setItem('simpletimer.jiraSubdomain', this.jiraSubdomain);
            this.settingsOpen = false;
        },

        closeSettings: function () {
            this.settingsOpen = false;
        },

		stopTimer: function () {
			if (null != this.timedTask) {
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

			navigator.clipboard.writeText(d.getFullYear() + '' + month + '' + d.getDate());
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

// mount
app.$mount('.timerapp')

/* for dev only:
app.newTask = 'ABC-123 lorem ipsum';
app.addTask();
app.startTimer(app.tasks[0]);
// */

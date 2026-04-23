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
		timerReadable: '',
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
				this.startedAt = Date.now();
				this.timerReadable = 'starting..';

				this.timerInterval = setInterval(this.updateTimer, 500);
			} else {
				console.warn('another task is already using the timer');
			}
		},

		updateTimer: function () {
			var runningForSeconds = Math.floor((Date.now() - this.startedAt) / 1000);
			//console.log('task is running for ' + runningForSeconds + 's already -- STILL RUNNING');

			this.timerReadable = this.formatSecondsAsReadable(runningForSeconds, false);
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
				this.timerReadable = 'stopping..';

				var ranForSeconds = Math.floor((Date.now() - this.startedAt) / 1000);
				//console.log('task ran for ' + ranForSeconds + 's -- STOPPED');

				this.timedTask.secondsSpent += ranForSeconds;
				this.timedTask.timeSpentReadable = this.formatSecondsAsReadable(this.timedTask.secondsSpent);

				// clear all vars related to the timer
				clearTimeout(this.timerInterval);
				this.timedTask = null;
                this.startedAt = 0;
				this.timerReadable = '';
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

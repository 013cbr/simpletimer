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
		todaysDate: new Date().toLocaleDateString(),
		startedAt: 0
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
		},

		addHour: function (task) {
			task.secondsSpent += 3600;
			task.timeSpentReadable = this.formatSecondsAsReadable(task.secondsSpent);
		},

		addQuarter: function (task) {
			task.secondsSpent += 900;
			task.timeSpentReadable = this.formatSecondsAsReadable(task.secondsSpent);
		},

		removeHour: function (task) {
			task.secondsSpent -= 3600;

            if (task.secondsSpent < 0) {
				task.secondsSpent = 0;
			}

			task.timeSpentReadable = this.formatSecondsAsReadable(task.secondsSpent);
		},

		removeQuarter: function (task) {
			task.secondsSpent -= 900;

            if (task.secondsSpent < 0) {
				task.secondsSpent = 0;
			}

			task.timeSpentReadable = this.formatSecondsAsReadable(task.secondsSpent);
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

			this.timerReadable = this.formatSecondsAsReadable(runningForSeconds);
		},

		formatSecondsAsReadable: function (secondsToFormat) {
            var hours = 0, minutes = 0, seconds = 0;

            if (secondsToFormat >= 3600) {
                hours   = Math.floor(secondsToFormat / 3600);
            }
            if (secondsToFormat >= 60) {
                minutes = Math.floor((secondsToFormat - (hours * 3600)) / 60);
            }
            seconds = secondsToFormat - (hours * 3600) - (minutes * 60);

            return hours + 'h ' + minutes + 'm ' + seconds + 's';
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

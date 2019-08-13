var WeekDay = new function () {

	this.getHourKey = function () {
		var d = new Date;
		return d.getHours();
	};

	this.getQuarterKey = function () {
		var d = new Date;
		var minute = d.getMinutes();

		if (45 <= minute) {
			return 45;
		}
		if (30 <= minute) {
			return 30;
		}
		if (15 <= minute) {
			return 15;
		}

		return 0;
	};
};

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { createError } from "../error.js";
import User from "../models/User.js";
import Workout from "../models/Workout.js";

dotenv.config();

export const UserRegister = async (req, res, next) => {
  try {
    const { email, password, name, img } = req.body;

    // Check if the email is in use
    const existingUser = await User.findOne({ email }).exec();
    if (existingUser) {
      return next(createError(409, "Email is already in use."));
    }

    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, salt);

    const user = new User({
      name,
      email,
      password: hashedPassword,
      img,
    });
    const createdUser = await user.save();
    const token = jwt.sign({ id: createdUser._id }, process.env.JWT, {
      expiresIn: "9999 years",
    });
    return res.status(200).json({ token, user });
  } catch (error) {
    return next(error);
  }
};

export const UserLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email: email });
    // Check if user exists
    if (!user) {
      return next(createError(404, "User not found"));
    }
    console.log(user);
    // Check if password is correct
    const isPasswordCorrect = await bcrypt.compareSync(password, user.password);
    if (!isPasswordCorrect) {
      return next(createError(403, "Incorrect password"));
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT, {
      expiresIn: "9999 years",
    });

    return res.status(200).json({ token, user });
  } catch (error) {
    return next(error);
  }
};

export const getUserDashboard = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const user = await User.findById(userId);
    if (!user) {
      return next(createError(404, "User not found"));
    }

    const currentDateFormatted = new Date();
    const startToday = new Date(
      currentDateFormatted.getFullYear(),
      currentDateFormatted.getMonth(),
      currentDateFormatted.getDate()
    );
    const endToday = new Date(
      currentDateFormatted.getFullYear(),
      currentDateFormatted.getMonth(),
      currentDateFormatted.getDate() + 1
    );

    //calculte total calories burnt
    const totalCaloriesBurnt = await Workout.aggregate([
      { $match: { user: user._id, date: { $gte: startToday, $lt: endToday } } },
      {
        $group: {
          _id: null,
          totalCaloriesBurnt: { $sum: "$caloriesBurned" },
        },
      },
    ]);

    //Calculate total no of workouts
    const totalWorkouts = await Workout.countDocuments({
      user: userId,
      date: { $gte: startToday, $lt: endToday },
    });

    //Calculate average calories burnt per workout
    const avgCaloriesBurntPerWorkout =
      totalCaloriesBurnt.length > 0
        ? totalCaloriesBurnt[0].totalCaloriesBurnt / totalWorkouts
        : 0;

    // Fetch category of workouts
    const categoryCalories = await Workout.aggregate([
      { $match: { user: user._id, date: { $gte: startToday, $lt: endToday } } },
      {
        $group: {
          _id: "$category",
          totalCaloriesBurnt: { $sum: "$caloriesBurned" },
        },
      },
    ]);

    //Format category data for pie chart

    const pieChartData = categoryCalories.map((category, index) => ({
      id: index,
      value: category.totalCaloriesBurnt,
      label: category._id,
    }));

    const weeks = [];
    const caloriesBurnt = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(
        currentDateFormatted.getTime() - i * 24 * 60 * 60 * 1000
      );
      weeks.push(`${date.getDate()}th`);

      const startOfDay = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
      );
      const endOfDay = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() + 1
      );

      const weekData = await Workout.aggregate([
        {
          $match: {
            user: user._id,
            date: { $gte: startOfDay, $lt: endOfDay },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
            totalCaloriesBurnt: { $sum: "$caloriesBurned" },
          },
        },
        {
          $sort: { _id: 1 }, // Sort by date in ascending order
        },
      ]);

      caloriesBurnt.push(
        weekData[0]?.totalCaloriesBurnt ? weekData[0]?.totalCaloriesBurnt : 0
      );
    }

    return res.status(200).json({
      totalCaloriesBurnt:
        totalCaloriesBurnt.length > 0
          ? totalCaloriesBurnt[0].totalCaloriesBurnt
          : 0,
      totalWorkouts: totalWorkouts,
      avgCaloriesBurntPerWorkout: avgCaloriesBurntPerWorkout,
      totalWeeksCaloriesBurnt: {
        weeks: weeks,
        caloriesBurned: caloriesBurnt,
      },
      pieChartData: pieChartData,
    });
  } catch (err) {
    next(err);
  }
};

export const getWorkoutsByDate = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const user = await User.findById(userId);
    let date = req.query.date ? new Date(req.query.date) : new Date();
    if (!user) {
      return next(createError(404, "User not found"));
    }
    const startOfDay = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );
    const endOfDay = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + 1
    );

    const todaysWorkouts = await Workout.find({
      userId: userId,
      date: { $gte: startOfDay, $lt: endOfDay },
    });
    const totalCaloriesBurnt = todaysWorkouts.reduce(
      (total, workout) => total + workout.caloriesBurned,
      0
    );

    return res.status(200).json({ todaysWorkouts, totalCaloriesBurnt });
  } catch (err) {
    next(err);
  }
};

export const addWorkout = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const { workoutString } = req.body;

    if (!workoutString) {
      return next(createError(400, "Workout string is missing"));
    }

    // Split workoutString into lines and trim whitespace
    const eachworkout = workoutString.split("\n").map((line) => line.trim());

    let currentCategory = "";
    let parsedWorkouts = [];
    let count = 0;

    console.log("Raw Workout String:", eachworkout); // Debugging

    for (const line of eachworkout) {
      count++;

      if (!line) continue; // Skip empty lines
      console.log(`Processing Line: "${line}"`); // Debugging

      if (line.startsWith("#")) {
        currentCategory = line.substring(1).trim();
        console.log(`Category Detected: ${currentCategory}`); // Debugging
      } else {
        // Try to split based on specific structure for workout details
        const parts = parseLineParts(line); // Use this helper function

        // If the line has valid parts, parse it
        if (parts && parts.length >= 4) { // Now it's checking for 4 parts
          // Wrap parseWorkoutLine call with try-catch to avoid unhandled errors
          let workoutDetails;
          try {
            workoutDetails = parseWorkoutLine(parts);
          } catch (err) {
            console.error(`Error parsing line ${count}:`, err);
            continue; // Skip this line if parsing fails
          }

          if (!workoutDetails) {
            console.log(`Skipping Invalid Workout #${count}`);
            continue; // Skip if parsing failed
          }

          workoutDetails.category = currentCategory;
          parsedWorkouts.push(workoutDetails);
        } else {
          console.log(`Skipping Invalid Line #${count}: ${line}`);
        }
      }
    }

    console.log("Parsed Workouts Before Save:", parsedWorkouts); // Debugging

    if (parsedWorkouts.length === 0) {
      return next(createError(400, "No valid workouts found"));
    }

    // Save workouts to MongoDB
    const savedWorkouts = [];
    for (const workout of parsedWorkouts) {
      workout.caloriesBurned = parseFloat(calculateCaloriesBurnt(workout));

      try {
        const savedWorkout = await Workout.create({ ...workout, user: userId });
        console.log("Workout Saved in DB:", savedWorkout); // Debugging
        savedWorkouts.push(savedWorkout);
      } catch (error) {
        console.error("MongoDB Save Error:", error);
      }
    }

    console.log("Final Response Data:", savedWorkouts); // Debugging

    return res.status(201).json({
      message: "Workouts added successfully",
      workouts: savedWorkouts,
    });
  } catch (err) {
    console.error("API Error:", err);
    return next(createError(500, "Internal Server Error"));
  }
};

// Helper function to parse line into parts
const parseLineParts = (line) => {
  // Remove the leading '-' sign and split by the first space or any known pattern
  const parts = line.substring(1).split(/\s+/).map((part) => part.trim());

  // Now, ensure that the parts contain at least 4 items (workoutName, sets, reps, etc.)
  return parts.length >= 4 ? parts : null;
};

// Your existing parseWorkoutLine function
const parseWorkoutLine = (parts) => {
  const details = {};
  console.log(parts);  // Debugging
  if (parts.length >= 4) {
    details.workoutName = parts[0];  // First part will be the workout name
    details.sets = parseInt(parts[1].split("sets")[0].trim());  // Extract sets from 'setsX15 reps'
    details.reps = parseInt(parts[1].split("X")[1].split("reps")[0].trim());  // Extract reps
    details.weight = parseFloat(parts[2].split("kg")[0].trim());  // Extract weight in kg
    details.duration = parseFloat(parts[3].split("min")[0].trim());  // Extract duration in minutes
    console.log(details);  // Debugging
    return details;
  }
  return null;
};



// Function to calculate calories burnt for a workout
const calculateCaloriesBurnt = (workoutDetails) => {
  const durationInMinutes = parseInt(workoutDetails.duration);
  const weightInKg = parseInt(workoutDetails.weight);
  const caloriesBurntPerMinute = 5; // Sample value, actual calculation may vary
  return durationInMinutes * caloriesBurntPerMinute * weightInKg;
};

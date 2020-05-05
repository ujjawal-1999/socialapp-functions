const { admin, db } = require('../util/admin');
const firebaseConfig = require('../util/config');
const { uuid } = require("uuidv4");

const firebase = require('firebase');
firebase.initializeApp(firebaseConfig);

const { validateSignupData, validateLoginData, reduceUserDetails } = require('../util/validators');

//SignUp User
exports.signup = (req,res)=>{
    const newUser = {
        email: req.body.email,
        password: req.body.password,
        confirmPassword: req.body.confirmPassword,
        handle : req.body.handle
    };

    const { valid, errors } = validateSignupData(newUser);

    if(!valid) return res.status(400).json(errors);

    const noImg = 'no.img.png';

    let token,userId;
    db.doc(`/users/${newUser.handle}`).get()
    .then(doc=>{
        if(doc.exists){
            return res.status(400).json({handle:'This handle is already taken'});
        }
        else{
            return firebase
            .auth()
            .createUserWithEmailAndPassword(newUser.email,newUser.password);
        }
    })
    .then((data)=>{
        userId = data.user.uid;
        return data.user.getIdToken();
    })
    .then((idtoken)=>{
        token = idtoken;
        const userCredentials = {
            handle: newUser.handle,
            email: newUser.email,
            completedAt: new Date().toISOString(),
            imageUrl : `https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o/${noImg}?alt=media`,
            userId
        };
        return db.doc(`/users/${newUser.handle}`).set(userCredentials);
    })
    .then(()=>{
        return res.status(201).json({ token });
    })
    .catch((err)=>{
        console.error(err);
        if(err.code === 'auth/email-already-in-use')
            return res.status(400).json({email:'Email is already is use'});
        else
            return res.status(500).json({general : 'Something went wrong. Please try again'});
    });
};

//Login User
exports.login = (req,res)=>{
    const user = {
        email : req.body.email,
        password : req.body.password  
    };
    const { valid, errors } = validateLoginData(user);

    if(!valid) return res.status(400).json(errors);

    firebase.auth().signInWithEmailAndPassword(user.email,user.password)
    .then((data)=>{
        return data.user.getIdToken();
    })
    .then((token)=>{
        return res.json({token});
    })
    .catch((err)=>{
        console.error(err);
            return res.status(403).json({ general: 'Wrong Credentials. Please try again'});
    });
};

//Add User Details
exports.addUserDetails = (req,res)=>{
  let userDetails = reduceUserDetails(req.body);

  db.doc(`/users/${req.user.handle}`).update(userDetails)
    .then(()=>{
      return res.json({message : 'Details added successfully'});
    })
    .catch((err)=>{
      console.error(err);
      return res.status(500).json({error: err.code});
    });

};

//Get Own User Details
exports.getAuthenticatedUser = (req,res)=>{
  let userData = {};
  db.doc(`/users/${req.user.handle}`).get()
  .then((doc)=>{
    if(doc.exists){
      userData.credentials = doc.data();
      return db.collection('likes').where('userHandle','==',req.user.handle).get()
    }
  })
  .then((data)=>{
    userData.likes = [];
    data.forEach((doc)=>{
      userData.likes.push(doc.data());
    });
    return db.collection('notifications').where('recipient', '==', req.user.handle)
      .orderBy('completedAt','desc').limit(10).get();
  })
  .then((data)=>{
    userData.notifications = [];
    data.forEach((doc)=>{
      userData.notifications.push({
        recipient : doc.data().recipient,
        sender : doc.data().sender,
        completedAt : doc.data().completedAt,
        screamId : doc.data().screamId,
        type : doc.data().type,
        read : doc.data().read,
        notificationId: doc.id
      })
    });
    return res.json({userData});
  })
  .catch((err)=>{
    console.error(err);
    return res.status(500).json({error: err.code});
  });
};

//Get any user Details

exports.getUserDetails = (req,res)=>{
    let userData = {};
    db.doc(`/users/${req.params.handle}`)
      .get()
      .then((doc)=>{
        if(doc.exists){
          userData.user = doc.data();
          return db
            .collection('screams')
            .where('userHandle','==',req.params.handle)
            .orderBy('completedAt','desc')
            .get();
        }
        else{
          return res.status(404).json({ error : err.code });
        }
      })
      .then((data)=>{
        userData.screams = [];
        data.forEach((doc)=>{
          userData.screams.push({
            body: doc.data().body,
            completedAt: doc.data().co6mpletedAt,
            userHandle : doc.data().userHandle,
            userImage : doc.data().userImage,
            likeCount: doc.data().likeCount,
            commentCount: doc.data().commentCount,
            screamId: doc.id,
          });
        });
        return res.json(userData);
      })
      .catch((err)=>{
        console.error(err);
        return res.status(500).json({ error: err.code });
      });
};

//Upload a profile image
exports.uploadImage = (req, res) => {
    const BusBoy = require("busboy");
    const path = require("path");
    const os = require("os");
    const fs = require("fs");
  
    const busboy = new BusBoy({ headers: req.headers });
  
    let imageToBeUploaded = {};
    let imageFileName;
    // String for image token
    let generatedToken = uuid();
  
    busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
      console.log(fieldname, file, filename, encoding, mimetype);
      if (mimetype !== "image/jpeg" && mimetype !== "image/png") {
        return res.status(400).json({ error: "Wrong file type submitted" });
      }
      const imageExtension = filename.split(".")[(filename.split(".").length) - 1];
      imageFileName = `${Math.round(
        Math.random() * 1000000000000
      ).toString()}.${imageExtension}`;
      const filepath = path.join(os.tmpdir(), imageFileName);
      imageToBeUploaded = { filepath, mimetype };
      file.pipe(fs.createWriteStream(filepath));
    });
    busboy.on("finish", () => {
      admin
        .storage()
        .bucket()
        .upload(imageToBeUploaded.filepath, {
          resumable: false,
          metadata: {
            metadata: {
              contentType: imageToBeUploaded.mimetype,
              firebaseStorageDownloadTokens: generatedToken,
            },
          },
        })
        .then(() => {
          // Append token to url
          const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o/${imageFileName}?alt=media&token=${generatedToken}`;
          return db.doc(`/users/${req.user.handle}`).update({ imageUrl });
        })
        .then(() => {
          return res.json({ message: "image uploaded successfully" });
        })
        .catch((err) => {
          console.error(err);
          return res.status(500).json({ error: "something went wrong" });
        });
    });
    busboy.end(req.rawBody);
  };

  //Mark notifications as read
  exports.markNotificationsRead = (req,res)=>{
    let batch = db.batch();
    req.body.forEach((notificationId) => {
      const notification = db.doc(`/notifications/${notificationId}`);
      batch.update(notification, { read: true });
    });
    batch
      .commit()
      .then(() => {
        return res.json({ message: "Notifications marked read" });
      })
      .catch((err) => {
        console.error(err);
        return res.status(500).json({ error: err.code });
      });
  };
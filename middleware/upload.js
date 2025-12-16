const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;

// Cấu hình Cloudinary từ biến môi trường
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Tạo thư mục uploads nếu chưa tồn tại
const createUploadsDirectory = () => {
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  const imagesDir = path.join(uploadsDir, 'images');
  const videosDir = path.join(uploadsDir, 'videos');

  [uploadsDir, imagesDir, videosDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

// Tạo thư mục uploads
createUploadsDirectory();

// Cấu hình storage cho multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = '';
    
    if (file.fieldname === 'image' || file.fieldname === 'avatar') {
      uploadPath = path.join(__dirname, '..', 'uploads', 'images');
    } else if (file.fieldname === 'video') {
      uploadPath = path.join(__dirname, '..', 'uploads', 'videos');
    } else {
      uploadPath = path.join(__dirname, '..', 'uploads');
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Tạo tên file unique với timestamp và random string
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, extension);
    
    // Làm sạch tên file
    const cleanBaseName = baseName.replace(/[^a-zA-Z0-9]/g, '_');
    
    cb(null, `${cleanBaseName}_${uniqueSuffix}${extension}`);
  }
});

// File filter function
const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'image' || file.fieldname === 'avatar') {
    // Chỉ cho phép các định dạng hình ảnh an toàn
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png', 
      'image/gif',
      'image/webp',
      'image/bmp'
    ];
    
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    if (allowedMimeTypes.includes(file.mimetype) && allowedExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ cho phép upload file hình ảnh (jpg, jpeg, png, gif, webp, bmp)'), false);
    }
  } else if (file.fieldname === 'video') {
    // Chỉ cho phép các định dạng video an toàn
    const allowedVideoMimeTypes = [
      'video/mp4',
      'video/avi', 
      'video/mov',
      'video/wmv',
      'video/webm'
    ];
    
    const allowedVideoExtensions = ['.mp4', '.avi', '.mov', '.wmv', '.webm'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    if (allowedVideoMimeTypes.includes(file.mimetype) && allowedVideoExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ cho phép upload file video (mp4, avi, mov, wmv, webm)'), false);
    }
  } else {
    cb(new Error('Field name không hợp lệ'), false);
  }
};

// Cấu hình multer
// IMAGE_MAX_MB: giới hạn kích thước cho ảnh (mặc định 10MB)
const IMAGE_MAX_MB = parseInt(process.env.IMAGE_MAX_MB, 10) || 300;
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: IMAGE_MAX_MB * 1024 * 1024, // ảnh/avatar giới hạn
    // Allow multiple files across different fields (image, avatar, video)
    // Per-field limits are enforced by upload.fields maxCount; here we relax total files.
    files: 5,
    fieldSize: 1 * 1024 * 1024 // 1MB cho field data
  }
});

// Cấu hình multer riêng cho video
// Cho phép cấu hình giới hạn upload video thông qua biến môi trường VIDEO_MAX_MB
const VIDEO_MAX_MB = parseInt(process.env.VIDEO_MAX_MB, 10) || 300; // default 300MB
const videoUpload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: VIDEO_MAX_MB * 1024 * 1024,
    files: 2,
    fieldSize: 1 * 1024 * 1024
  }
});

// Custom middleware để xử lý lỗi upload
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File quá lớn',
        error: 'Hình ảnh không được quá 10MB, video không được quá 300MB'
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Quá nhiều file',
        error: 'Chỉ được upload 1 hình ảnh và 1 video'
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Field không hợp lệ',
        error: 'Chỉ chấp nhận field "image" và "video"'
      });
    }
  }
  
  if (err) {
    return res.status(400).json({
      success: false,
      message: 'Lỗi upload file',
      error: err.message
    });
  }
  
  next();
};

// Upload file lên Cloudinary (helper)
const uploadToCloudinary = async (filePath, folder, resourceType = 'image') => {
  const options = {
    folder,
    resource_type: resourceType
  };

  const result = await cloudinary.uploader.upload(filePath, options);

  // Xóa file local sau khi upload xong
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  return result.secure_url;
};

// Middleware để upload file lên Cloudinary và gắn URL vào req.body
const processFileUrls = async (req, res, next) => {
  try {
    // Multiple files (image, avatar, video)
    if (req.files) {
      // Ảnh khóa học / avatar
      if (req.files.image && req.files.image[0]) {
        const imgFile = req.files.image[0];
        const imgPath = imgFile.path;
        const imageUrl = await uploadToCloudinary(
          imgPath,
          'courses/images',
          'image'
        );
        req.body.image = imageUrl;
      }

      if (req.files.avatar && req.files.avatar[0]) {
        const avatarFile = req.files.avatar[0];
        const avatarPath = avatarFile.path;
        const avatarUrl = await uploadToCloudinary(
          avatarPath,
          'avatars',
          'image'
        );
        req.body.avatar = avatarUrl;
      }

      // Video khóa học
      if (req.files.video && req.files.video[0]) {
        const vidFile = req.files.video[0];
        const vidPath = vidFile.path;
        const videoUrl = await uploadToCloudinary(
          vidPath,
          'courses/videos',
          'video'
        );
        req.body.video = videoUrl;
      }
    }

    // Single file upload
    if (req.file && req.file.path) {
      const file = req.file;
      const filePath = file.path;

      if (file.fieldname === 'avatar' || file.fieldname === 'image') {
        const imageUrl = await uploadToCloudinary(
          filePath,
          file.fieldname === 'avatar' ? 'avatars' : 'courses/images',
          'image'
        );
        if (file.fieldname === 'avatar') {
          req.body.avatar = imageUrl;
        } else {
          req.body.image = imageUrl;
        }
      } else if (file.fieldname === 'video') {
        const videoUrl = await uploadToCloudinary(
          filePath,
          'courses/videos',
          'video'
        );
        req.body.video = videoUrl;
      }
    }

    next();
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi khi upload file lên Cloudinary',
      error: error.message
    });
  }
};

// Middleware để xóa file cũ khi upload file mới
const removeOldFile = (oldFilePath) => {
  return (req, res, next) => {
    if (oldFilePath && fs.existsSync(oldFilePath)) {
      fs.unlinkSync(oldFilePath);
    }
    next();
  };
};

// Export upload methods
const uploadSingle = (fieldName) => {
  return upload.single(fieldName);
};

const uploadVideo = (fieldName) => {
  return videoUpload.single(fieldName);
};

const uploadFields = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'avatar', maxCount: 1 },
  { name: 'video', maxCount: 1 }
]);

// Middleware đặc biệt cho avatar upload
const uploadAvatar = upload.single('avatar');

module.exports = {
  upload,
  videoUpload,
  uploadSingle,
  uploadVideo,
  uploadFields,
  uploadAvatar,
  handleUploadError,
  processFileUrls,
  removeOldFile
};